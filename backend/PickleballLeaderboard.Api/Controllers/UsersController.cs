using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PickleballLeaderboard.Api.Data;
using PickleballLeaderboard.Api.Dtos;
using PickleballLeaderboard.Api.Entities;
using PickleballLeaderboard.Api.Infrastructure;
using PickleballLeaderboard.Api.Services;

namespace PickleballLeaderboard.Api.Controllers;

/// <summary>Admin management of login accounts.</summary>
[ApiController]
[Route("api/users")]
[Authorize(Roles = "Admin")]
public class UsersController(AppDbContext db, IPasswordService passwords, ILeaderboardService leaderboard)
    : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PagedResult<UserDto>>> List(
        [FromQuery] string? search,
        [FromQuery] UserRole? role,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = db.Users.AsNoTracking().Include(u => u.Player).AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search.Trim()}%";
            q = q.Where(u => EF.Functions.ILike(u.Email, term) ||
                             (u.Player != null && EF.Functions.ILike(u.Player.FullName, term)));
        }
        if (role.HasValue) q = q.Where(u => u.Role == role);

        var total = await q.CountAsync(ct);
        var items = await q.OrderBy(u => u.Email).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return Ok(new PagedResult<UserDto>(items.Select(u => u.ToDto()).ToList(), page, pageSize, total));
    }

    [HttpPost]
    public async Task<ActionResult<UserDto>> Create(AdminCreateUserRequest req, CancellationToken ct)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.Email == email, ct))
            throw new ConflictException("An account with this email already exists.");

        var user = new User { Email = email, Role = req.Role!.Value, IsActive = true };
        user.PasswordHash = passwords.Hash(user, req.Password);

        if (req.PlayerId.HasValue)
        {
            var player = await db.Players.FirstOrDefaultAsync(p => p.Id == req.PlayerId, ct)
                         ?? throw new NotFoundException("Player not found.");
            if (player.UserId.HasValue) throw new ConflictException("That player already has an account.");
            player.User = user;
        }
        else
        {
            db.Users.Add(user);
        }

        await db.SaveChangesAsync(ct);
        await db.Entry(user).Reference(u => u.Player).LoadAsync(ct);
        return Ok(user.ToDto());
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<UserDto>> Update(int id, AdminUpdateUserRequest req, CancellationToken ct)
    {
        var user = await db.Users.Include(u => u.Player).FirstOrDefaultAsync(u => u.Id == id, ct)
                   ?? throw new NotFoundException("User not found.");

        var isSelf = id == User.GetUserId();
        if (isSelf && (!req.IsActive || req.Role != UserRole.Admin))
            throw new BadRequestException("You cannot deactivate or demote your own account.");

        if (user.Role == UserRole.Admin && (req.Role != UserRole.Admin || !req.IsActive))
        {
            var otherAdmins = await db.Users.CountAsync(u => u.Role == UserRole.Admin && u.IsActive && u.Id != id, ct);
            if (otherAdmins == 0) throw new BadRequestException("At least one active administrator is required.");
        }

        var email = req.Email.Trim().ToLowerInvariant();
        if (email != user.Email && await db.Users.AnyAsync(u => u.Email == email && u.Id != id, ct))
            throw new ConflictException("An account with this email already exists.");

        var activeChanged = user.IsActive != req.IsActive;

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        user.Email = email;
        user.Role = req.Role!.Value;
        user.IsActive = req.IsActive;
        if (activeChanged && user.Player is not null)
        {
            user.Player.IsActive = req.IsActive;
            user.Player.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync(ct);

        if (activeChanged && user.Player is not null) await leaderboard.RecalculateAsync(ct);
        await tx.CommitAsync(ct);

        return Ok(user.ToDto());
    }

    [HttpPost("{id:int}/reset-password")]
    public async Task<IActionResult> ResetPassword(int id, ResetPasswordRequest req, CancellationToken ct)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct)
                   ?? throw new NotFoundException("User not found.");
        user.PasswordHash = passwords.Hash(user, req.NewPassword);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
}
