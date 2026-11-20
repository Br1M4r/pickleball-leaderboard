using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PickleballLeaderboard.Api.Data;
using PickleballLeaderboard.Api.Dtos;
using PickleballLeaderboard.Api.Entities;
using PickleballLeaderboard.Api.Infrastructure;
using PickleballLeaderboard.Api.Services;

namespace PickleballLeaderboard.Api.Controllers;

[ApiController]
[Route("api/players")]
public class PlayersController(
    AppDbContext db,
    IPasswordService passwords,
    ILeaderboardService leaderboard) : ControllerBase
{
    private const int MaxPhotoBytes = 2 * 1024 * 1024;

    // ---------------------------------------------------------------- queries

    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<PagedResult<PlayerDto>>> List(
        [FromQuery] string? search,
        [FromQuery] Gender? gender,
        [FromQuery] SkillLevel? skillLevel,
        [FromQuery] PlayingCategory? category,
        [FromQuery] bool includeInactive = false,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var isAdmin = User.IsAdmin();

        var q = db.Players.AsNoTracking().Include(p => p.User).AsQueryable();
        if (!(includeInactive && isAdmin)) q = q.Where(p => p.IsActive);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search.Trim()}%";
            q = q.Where(p => EF.Functions.ILike(p.FullName, term) ||
                             (isAdmin && p.User != null && EF.Functions.ILike(p.User.Email, term)));
        }
        if (gender.HasValue) q = q.Where(p => p.Gender == gender);
        if (skillLevel.HasValue) q = q.Where(p => p.SkillLevel == skillLevel);
        if (category.HasValue) q = q.Where(p => p.PlayingCategory == category);

        var total = await q.CountAsync(ct);
        var items = await q.OrderBy(p => p.FullName)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync(ct);

        return Ok(new PagedResult<PlayerDto>(items.Select(p => p.ToDto(isAdmin)).ToList(), page, pageSize, total));
    }

    [HttpGet("{id:int}")]
    [AllowAnonymous]
    public async Task<ActionResult<PlayerDetailDto>> Get(int id, CancellationToken ct)
    {
        var player = await LoadVisiblePlayerAsync(id, ct);

        var standings = await db.Leaderboard.AsNoTracking()
            .Include(e => e.Player)
            .Where(e => e.PlayerId == id)
            .ToListAsync(ct);

        var recent = await db.Matches.AsNoTracking().WithDetails()
            .Where(m => m.Status != MatchStatus.Cancelled && m.Participants.Any(p => p.PlayerId == id))
            .OrderByDescending(m => m.PlayedAt).ThenByDescending(m => m.Id)
            .Take(10)
            .ToListAsync(ct);

        var totals = await ComputeTotalsAsync(id, ct);

        return Ok(new PlayerDetailDto(
            player.ToDto(User.IsAdmin()),
            standings.OrderBy(s => s.Scope).Select(s => s.ToRow()).ToList(),
            recent.Select(m => m.ToDto()).ToList(),
            totals));
    }

    [HttpGet("{id:int}/matches")]
    [AllowAnonymous]
    public async Task<ActionResult<PagedResult<MatchDto>>> Matches(
        int id, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        await LoadVisiblePlayerAsync(id, ct);
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = db.Matches.AsNoTracking()
            .Where(m => m.Status != MatchStatus.Cancelled && m.Participants.Any(p => p.PlayerId == id));

        var total = await q.CountAsync(ct);
        var items = await q.WithDetails()
            .OrderByDescending(m => m.PlayedAt).ThenByDescending(m => m.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync(ct);

        return Ok(new PagedResult<MatchDto>(items.Select(m => m.ToDto()).ToList(), page, pageSize, total));
    }

    [HttpGet("{id:int}/photo")]
    [AllowAnonymous]
    [ResponseCache(Duration = 86400, Location = ResponseCacheLocation.Any)]
    public async Task<IActionResult> Photo(int id, CancellationToken ct)
    {
        var photo = await db.PlayerPhotos.AsNoTracking().FirstOrDefaultAsync(p => p.PlayerId == id, ct);
        if (photo is null) return NotFound();
        return File(photo.Data, photo.ContentType);
    }

    // ---------------------------------------------------------------- admin commands

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<PlayerDto>> Create(AdminCreatePlayerRequest req, CancellationToken ct)
    {
        var player = new Player
        {
            FullName = req.FullName.Trim(),
            Gender = req.Gender!.Value,
            Age = req.Age!.Value,
            SkillLevel = req.SkillLevel!.Value,
            PlayingCategory = req.PlayingCategory!.Value,
            DateRegistered = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            IsActive = true
        };

        var wantsAccount = !string.IsNullOrWhiteSpace(req.Email) || !string.IsNullOrWhiteSpace(req.Password);
        if (wantsAccount)
        {
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
                throw new BadRequestException("Provide both email and password to create a login for this player.");

            var email = req.Email.Trim().ToLowerInvariant();
            if (await db.Users.AnyAsync(u => u.Email == email, ct))
                throw new ConflictException("An account with this email already exists.");

            var user = new User { Email = email, Role = UserRole.Player, IsActive = true };
            user.PasswordHash = passwords.Hash(user, req.Password);
            player.User = user;
        }

        db.Players.Add(player);
        await db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(Get), new { id = player.Id }, player.ToDto(true));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<PlayerDto>> Update(int id, PlayerUpsertRequest req, CancellationToken ct)
    {
        var player = await db.Players.Include(p => p.User).FirstOrDefaultAsync(p => p.Id == id, ct)
                     ?? throw new NotFoundException("Player not found.");

        player.FullName = req.FullName.Trim();
        player.Gender = req.Gender!.Value;
        player.Age = req.Age!.Value;
        player.SkillLevel = req.SkillLevel!.Value;
        player.PlayingCategory = req.PlayingCategory!.Value;
        player.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);
        return Ok(player.ToDto(true));
    }

    /// <summary>Activate or deactivate a player (and their login). Inactive players are removed from rankings.</summary>
    [HttpPatch("{id:int}/status")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<PlayerDto>> SetStatus(int id, SetActiveRequest req, CancellationToken ct)
    {
        var player = await db.Players.Include(p => p.User).FirstOrDefaultAsync(p => p.Id == id, ct)
                     ?? throw new NotFoundException("Player not found.");

        if (player.User is { Role: UserRole.Admin } && player.User.Id == User.GetUserId() && !req.IsActive)
            throw new BadRequestException("You cannot deactivate your own account.");

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        player.IsActive = req.IsActive;
        player.UpdatedAt = DateTime.UtcNow;
        if (player.User is not null) player.User.IsActive = req.IsActive;
        await db.SaveChangesAsync(ct);

        await leaderboard.RecalculateAsync(ct);
        await tx.CommitAsync(ct);

        return Ok(player.ToDto(true));
    }

    // ---------------------------------------------------------------- self-service

    [HttpPut("me")]
    [Authorize]
    public async Task<ActionResult<PlayerDto>> UpdateMe(SelfUpdatePlayerRequest req, CancellationToken ct)
    {
        var playerId = User.GetPlayerId() ?? throw new BadRequestException("Your account has no player profile.");
        var player = await db.Players.FirstOrDefaultAsync(p => p.Id == playerId, ct)
                     ?? throw new NotFoundException("Player not found.");

        player.FullName = req.FullName.Trim();
        player.Age = req.Age!.Value;
        player.PlayingCategory = req.PlayingCategory!.Value;
        player.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return Ok(player.ToDto());
    }

    [HttpPost("{id:int}/photo")]
    [Authorize]
    [RequestSizeLimit(MaxPhotoBytes + 64 * 1024)]
    public async Task<ActionResult<PlayerDto>> UploadPhoto(int id, IFormFile file, CancellationToken ct)
    {
        EnsureCanEdit(id);

        if (file is null || file.Length == 0) throw new BadRequestException("Choose an image to upload.");
        if (file.Length > MaxPhotoBytes) throw new BadRequestException("Image must be 2 MB or smaller.");

        await using var ms = new MemoryStream();
        await file.CopyToAsync(ms, ct);
        var bytes = ms.ToArray();

        var contentType = DetectImageType(bytes)
                          ?? throw new BadRequestException("Only JPEG, PNG, GIF or WEBP images are allowed.");

        var player = await db.Players.Include(p => p.Photo).FirstOrDefaultAsync(p => p.Id == id, ct)
                     ?? throw new NotFoundException("Player not found.");

        var now = DateTime.UtcNow;
        if (player.Photo is null)
            player.Photo = new PlayerPhoto { PlayerId = id, Data = bytes, ContentType = contentType, UpdatedAt = now };
        else
        {
            player.Photo.Data = bytes;
            player.Photo.ContentType = contentType;
            player.Photo.UpdatedAt = now;
        }
        player.PhotoUpdatedAt = now;
        await db.SaveChangesAsync(ct);

        return Ok(player.ToDto(User.IsAdmin()));
    }

    [HttpDelete("{id:int}/photo")]
    [Authorize]
    public async Task<IActionResult> DeletePhoto(int id, CancellationToken ct)
    {
        EnsureCanEdit(id);
        var player = await db.Players.Include(p => p.Photo).FirstOrDefaultAsync(p => p.Id == id, ct)
                     ?? throw new NotFoundException("Player not found.");
        if (player.Photo is not null) db.PlayerPhotos.Remove(player.Photo);
        player.PhotoUpdatedAt = null;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ---------------------------------------------------------------- helpers

    private void EnsureCanEdit(int playerId)
    {
        if (User.IsAdmin()) return;
        if (User.GetPlayerId() != playerId) throw new ForbiddenException();
    }

    private async Task<Player> LoadVisiblePlayerAsync(int id, CancellationToken ct)
    {
        var player = await db.Players.AsNoTracking().Include(p => p.User)
                         .FirstOrDefaultAsync(p => p.Id == id, ct)
                     ?? throw new NotFoundException("Player not found.");

        var canSeeInactive = User.IsAdmin() || (User.Identity?.IsAuthenticated == true && User.GetPlayerId() == id);
        if (!player.IsActive && !canSeeInactive) throw new NotFoundException("Player not found.");
        return player;
    }

    /// <summary>Career totals across every completed match, independent of ranking scope.</summary>
    private async Task<PlayerTotalsDto> ComputeTotalsAsync(int playerId, CancellationToken ct)
    {
        var rows = await db.MatchParticipants.AsNoTracking()
            .Where(p => p.PlayerId == playerId &&
                        p.Match.Status == MatchStatus.Completed &&
                        p.Match.Result != null)
            .OrderBy(p => p.Match.PlayedAt).ThenBy(p => p.MatchId)
            .Select(p => new
            {
                p.Team,
                p.Match.Result!.WinningTeam,
                p.Match.Result.Team1Score,
                p.Match.Result.Team2Score
            })
            .ToListAsync(ct);

        int wins = 0, losses = 0, pf = 0, pa = 0, streak = 0, longest = 0;
        foreach (var r in rows)
        {
            var mine = r.Team == 1 ? r.Team1Score : r.Team2Score;
            var theirs = r.Team == 1 ? r.Team2Score : r.Team1Score;
            pf += mine;
            pa += theirs;
            if (r.WinningTeam == r.Team)
            {
                wins++;
                streak++;
                longest = Math.Max(longest, streak);
            }
            else
            {
                losses++;
                streak = 0;
            }
        }

        var played = wins + losses;
        var pct = played == 0 ? 0m : Math.Round(wins * 100m / played, 2, MidpointRounding.AwayFromZero);
        return new PlayerTotalsDto(played, wins, losses, pct, pf, pa, streak, longest);
    }

    private static string? DetectImageType(byte[] b)
    {
        if (b.Length < 12) return null;
        if (b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "image/jpeg";
        if (b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return "image/png";
        if (b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x38) return "image/gif";
        if (b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 &&
            b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50) return "image/webp";
        return null;
    }
}
