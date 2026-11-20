using System.Text.Json;
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
[Route("api/matches")]
public class MatchesController(AppDbContext db, ILeaderboardService leaderboard) : ControllerBase
{
    // ---------------------------------------------------------------- queries

    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<PagedResult<MatchDto>>> List(
        [FromQuery] MatchStatus? status,
        [FromQuery] MatchFormat? matchType,
        [FromQuery] MatchCategory? category,
        [FromQuery] int? playerId,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = db.Matches.AsNoTracking().AsQueryable();

        if (status.HasValue)
        {
            if (status == MatchStatus.Cancelled && !User.IsAdmin()) throw new ForbiddenException();
            q = q.Where(m => m.Status == status);
        }
        else
        {
            q = q.Where(m => m.Status != MatchStatus.Cancelled);
        }

        if (matchType.HasValue) q = q.Where(m => m.MatchType == matchType);
        if (category.HasValue) q = q.Where(m => m.Category == category);
        if (playerId.HasValue) q = q.Where(m => m.Participants.Any(p => p.PlayerId == playerId));
        if (from.HasValue) { var f = from.Value.ToUtc(); q = q.Where(m => m.PlayedAt >= f); }
        if (to.HasValue) { var t = to.Value.ToUtc(); q = q.Where(m => m.PlayedAt <= t); }

        var total = await q.CountAsync(ct);
        var items = await q.WithDetails()
            .OrderByDescending(m => m.PlayedAt).ThenByDescending(m => m.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync(ct);

        return Ok(new PagedResult<MatchDto>(items.Select(m => m.ToDto()).ToList(), page, pageSize, total));
    }

    [HttpGet("{id:int}")]
    [AllowAnonymous]
    public async Task<ActionResult<MatchDto>> Get(int id, CancellationToken ct)
    {
        var match = await db.Matches.AsNoTracking().WithDetails().FirstOrDefaultAsync(m => m.Id == id, ct)
                    ?? throw new NotFoundException("Match not found.");
        if (match.Status == MatchStatus.Cancelled && !User.IsAdmin())
            throw new NotFoundException("Match not found.");
        return Ok(match.ToDto());
    }

    [HttpGet("{id:int}/history")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<IReadOnlyList<MatchHistoryDto>>> History(int id, CancellationToken ct)
    {
        if (!await db.Matches.AnyAsync(m => m.Id == id, ct)) throw new NotFoundException("Match not found.");

        var rows = await db.MatchResultHistory.AsNoTracking()
            .Where(h => h.MatchId == id)
            .OrderByDescending(h => h.ChangedAt).ThenByDescending(h => h.Id)
            .Select(h => new
            {
                h.Id, h.Action, h.ChangedAt, Email = h.ChangedBy.Email, h.Reason, h.PreviousValues, h.NewValues
            })
            .ToListAsync(ct);

        return Ok(rows.Select(h => new MatchHistoryDto(
            h.Id, h.Action, h.ChangedAt, h.Email, h.Reason, ParseJson(h.PreviousValues), ParseJson(h.NewValues)))
            .ToList());
    }

    // ---------------------------------------------------------------- commands (admin only)

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<MatchDto>> Create(MatchUpsertRequest req, CancellationToken ct)
    {
        var userId = User.GetUserId();
        var playedAt = req.PlayedAt!.Value.ToUtc();
        var players = await ValidateLineupAsync(req, existingMatchPlayerIds: null, ct);

        if (req.Result is not null) ValidateScore(req.Result.Team1Score!.Value, req.Result.Team2Score!.Value, playedAt);

        var now = DateTime.UtcNow;
        var match = new Match
        {
            MatchType = req.MatchType!.Value,
            Category = req.Category!.Value,
            PlayedAt = playedAt,
            Location = Clean(req.Location),
            Notes = Clean(req.Notes),
            Status = MatchStatus.Scheduled,
            CreatedByUserId = userId,
            CreatedAt = now,
            UpdatedAt = now
        };
        foreach (var pid in req.Team1PlayerIds)
            match.Participants.Add(new MatchParticipant { PlayerId = pid, Player = players[pid], Team = 1 });
        foreach (var pid in req.Team2PlayerIds)
            match.Participants.Add(new MatchParticipant { PlayerId = pid, Player = players[pid], Team = 2 });

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        if (req.Result is not null)
            ApplyResult(match, req.Result.Team1Score!.Value, req.Result.Team2Score!.Value, userId, now);

        db.Matches.Add(match);
        var history = AddHistory(match, MatchHistoryAction.MatchCreated, userId, null, null);
        history.NewValues = match.Snapshot();

        await db.SaveChangesAsync(ct);

        if (match.Status == MatchStatus.Completed) await leaderboard.RecalculateAsync(ct);
        await tx.CommitAsync(ct);

        return CreatedAtAction(nameof(Get), new { id = match.Id }, match.ToDto());
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<MatchDto>> Update(int id, MatchUpsertRequest req, CancellationToken ct)
    {
        var userId = User.GetUserId();
        var match = await db.Matches.WithDetails().FirstOrDefaultAsync(m => m.Id == id, ct)
                    ?? throw new NotFoundException("Match not found.");

        if (match.Status == MatchStatus.Cancelled)
            throw new BadRequestException("Restore the match before editing it.");

        var playedAt = req.PlayedAt!.Value.ToUtc();
        var hadResult = match.Result is not null;
        if (hadResult && string.IsNullOrWhiteSpace(req.Reason))
            throw new BadRequestException("A reason is required when editing a match that already has a result.");

        var currentIds = match.Participants.Select(p => p.PlayerId).ToHashSet();
        var players = await ValidateLineupAsync(req, currentIds, ct);

        if (hadResult && playedAt > DateTime.UtcNow.AddDays(1))
            throw new BadRequestException("A completed match cannot be dated in the future.");

        var before = match.Snapshot();

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        match.MatchType = req.MatchType!.Value;
        match.Category = req.Category!.Value;
        match.PlayedAt = playedAt;
        match.Location = Clean(req.Location);
        match.Notes = Clean(req.Notes);
        match.UpdatedAt = DateTime.UtcNow;
        SyncParticipants(match, req, players);

        // Scores can only be changed through the result endpoint (with its own audit entry),
        // but a result can be added here when the match didn't have one yet.
        if (!hadResult && req.Result is not null)
        {
            ValidateScore(req.Result.Team1Score!.Value, req.Result.Team2Score!.Value, playedAt);
            ApplyResult(match, req.Result.Team1Score!.Value, req.Result.Team2Score!.Value, userId, DateTime.UtcNow);
        }

        var history = AddHistory(match, MatchHistoryAction.MatchUpdated, userId, Clean(req.Reason), before);
        history.NewValues = match.Snapshot();
        await db.SaveChangesAsync(ct);

        if (match.Status == MatchStatus.Completed) await leaderboard.RecalculateAsync(ct);
        await tx.CommitAsync(ct);

        return Ok(match.ToDto());
    }

    /// <summary>Record a result, or correct an existing one (reason required). Rankings are recalculated.</summary>
    [HttpPut("{id:int}/result")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<MatchDto>> RecordResult(int id, RecordResultRequest req, CancellationToken ct)
    {
        var userId = User.GetUserId();
        var match = await db.Matches.WithDetails().FirstOrDefaultAsync(m => m.Id == id, ct)
                    ?? throw new NotFoundException("Match not found.");

        if (match.Status == MatchStatus.Cancelled)
            throw new BadRequestException("Cannot record a result for a cancelled match.");

        var t1 = req.Team1Score!.Value;
        var t2 = req.Team2Score!.Value;
        ValidateScore(t1, t2, match.PlayedAt);

        var isCorrection = match.Result is not null;
        if (isCorrection && string.IsNullOrWhiteSpace(req.Reason))
            throw new BadRequestException("A reason is required when correcting a recorded result.");
        if (isCorrection && match.Result!.Team1Score == t1 && match.Result.Team2Score == t2)
            throw new BadRequestException("The new score is the same as the recorded score.");

        var before = match.Snapshot();
        var now = DateTime.UtcNow;

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        ApplyResult(match, t1, t2, userId, now);
        match.UpdatedAt = now;

        var history = AddHistory(match,
            isCorrection ? MatchHistoryAction.ResultCorrected : MatchHistoryAction.ResultRecorded,
            userId, Clean(req.Reason), before);
        history.NewValues = match.Snapshot();

        await db.SaveChangesAsync(ct);
        await leaderboard.RecalculateAsync(ct);
        await tx.CommitAsync(ct);

        return Ok(match.ToDto());
    }

    [HttpPost("{id:int}/cancel")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<MatchDto>> Cancel(int id, ReasonRequest req, CancellationToken ct)
    {
        var userId = User.GetUserId();
        var match = await db.Matches.WithDetails().FirstOrDefaultAsync(m => m.Id == id, ct)
                    ?? throw new NotFoundException("Match not found.");
        if (match.Status == MatchStatus.Cancelled) throw new BadRequestException("Match is already cancelled.");
        if (match.Result is not null && string.IsNullOrWhiteSpace(req.Reason))
            throw new BadRequestException("A reason is required to cancel a match that has a result.");

        var before = match.Snapshot();
        var wasCompleted = match.Status == MatchStatus.Completed;

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        match.Status = MatchStatus.Cancelled;
        match.UpdatedAt = DateTime.UtcNow;
        var history = AddHistory(match, MatchHistoryAction.MatchCancelled, userId, Clean(req.Reason), before);
        history.NewValues = match.Snapshot();
        await db.SaveChangesAsync(ct);

        if (wasCompleted) await leaderboard.RecalculateAsync(ct);
        await tx.CommitAsync(ct);

        return Ok(match.ToDto());
    }

    [HttpPost("{id:int}/restore")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<MatchDto>> Restore(int id, ReasonRequest req, CancellationToken ct)
    {
        var userId = User.GetUserId();
        var match = await db.Matches.WithDetails().FirstOrDefaultAsync(m => m.Id == id, ct)
                    ?? throw new NotFoundException("Match not found.");
        if (match.Status != MatchStatus.Cancelled) throw new BadRequestException("Match is not cancelled.");

        var before = match.Snapshot();

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        match.Status = match.Result is null ? MatchStatus.Scheduled : MatchStatus.Completed;
        match.UpdatedAt = DateTime.UtcNow;
        var history = AddHistory(match, MatchHistoryAction.MatchRestored, userId, Clean(req.Reason), before);
        history.NewValues = match.Snapshot();
        await db.SaveChangesAsync(ct);

        if (match.Status == MatchStatus.Completed) await leaderboard.RecalculateAsync(ct);
        await tx.CommitAsync(ct);

        return Ok(match.ToDto());
    }

    // ---------------------------------------------------------------- validation & helpers

    /// <summary>Validates team sizes, duplicates, player status and category/gender rules.</summary>
    private async Task<Dictionary<int, Player>> ValidateLineupAsync(
        MatchUpsertRequest req, HashSet<int>? existingMatchPlayerIds, CancellationToken ct)
    {
        var type = req.MatchType!.Value;
        var category = req.Category!.Value;
        var size = type == MatchFormat.Singles ? 1 : 2;

        if (req.Team1PlayerIds.Count != size || req.Team2PlayerIds.Count != size)
            throw new BadRequestException(type == MatchFormat.Singles
                ? "Singles matches need exactly one player per side."
                : "Doubles matches need exactly two players per side.");

        var all = req.Team1PlayerIds.Concat(req.Team2PlayerIds).ToList();
        if (all.Distinct().Count() != all.Count)
            throw new BadRequestException("A player can only appear once in a match.");

        if (category == MatchCategory.Mixed && type != MatchFormat.Doubles)
            throw new BadRequestException("Mixed category is only available for doubles.");

        var players = await db.Players.Where(p => all.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        var missing = all.Where(id => !players.ContainsKey(id)).ToList();
        if (missing.Count > 0) throw new BadRequestException($"Unknown player id(s): {string.Join(", ", missing)}.");

        var inactive = players.Values
            .Where(p => !p.IsActive && (existingMatchPlayerIds is null || !existingMatchPlayerIds.Contains(p.Id)))
            .Select(p => p.FullName).ToList();
        if (inactive.Count > 0) throw new BadRequestException($"Inactive player(s): {string.Join(", ", inactive)}.");

        switch (category)
        {
            case MatchCategory.Mens when players.Values.Any(p => p.Gender != Gender.Male):
                throw new BadRequestException("Men's matches can only include male players.");
            case MatchCategory.Womens when players.Values.Any(p => p.Gender != Gender.Female):
                throw new BadRequestException("Women's matches can only include female players.");
            case MatchCategory.Mixed:
                foreach (var team in new[] { req.Team1PlayerIds, req.Team2PlayerIds })
                {
                    var genders = team.Select(id => players[id].Gender).ToList();
                    if (!(genders.Contains(Gender.Male) && genders.Contains(Gender.Female)))
                        throw new BadRequestException("Each mixed doubles team needs one male and one female player.");
                }
                break;
        }

        return players;
    }

    private static void ValidateScore(int t1, int t2, DateTime playedAt)
    {
        if (t1 == t2) throw new BadRequestException("Pickleball matches cannot end in a tie.");
        if (t1 < 0 || t2 < 0) throw new BadRequestException("Scores cannot be negative.");
        if (playedAt > DateTime.UtcNow.AddDays(1))
            throw new BadRequestException("Cannot record a result for a match dated in the future.");
    }

    private static void ApplyResult(Match match, int t1, int t2, int userId, DateTime now)
    {
        var winner = t1 > t2 ? 1 : 2;
        if (match.Result is null)
        {
            match.Result = new MatchResult
            {
                Team1Score = t1, Team2Score = t2, WinningTeam = winner,
                RecordedByUserId = userId, RecordedAt = now
            };
        }
        else
        {
            match.Result.Team1Score = t1;
            match.Result.Team2Score = t2;
            match.Result.WinningTeam = winner;
            match.Result.UpdatedByUserId = userId;
            match.Result.UpdatedAt = now;
        }
        match.Status = MatchStatus.Completed;
    }

    private static void SyncParticipants(Match match, MatchUpsertRequest req, Dictionary<int, Player> players)
    {
        var desired = req.Team1PlayerIds.Select(id => (id, team: 1))
            .Concat(req.Team2PlayerIds.Select(id => (id, team: 2)))
            .ToDictionary(x => x.id, x => x.team);

        foreach (var p in match.Participants.ToList())
        {
            if (!desired.TryGetValue(p.PlayerId, out var team))
                match.Participants.Remove(p);
            else
                p.Team = team;
        }

        var existing = match.Participants.Select(p => p.PlayerId).ToHashSet();
        foreach (var (pid, team) in desired.Where(d => !existing.Contains(d.Key)).Select(d => (d.Key, d.Value)))
            match.Participants.Add(new MatchParticipant { PlayerId = pid, Player = players[pid], Team = team });
    }

    private MatchResultHistory AddHistory(Match match, MatchHistoryAction action, int userId, string? reason,
        string? previous)
    {
        var entry = new MatchResultHistory
        {
            Match = match,
            Action = action,
            ChangedByUserId = userId,
            ChangedAt = DateTime.UtcNow,
            Reason = reason,
            PreviousValues = previous
        };
        db.MatchResultHistory.Add(entry);
        return entry;
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static JsonElement? ParseJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
