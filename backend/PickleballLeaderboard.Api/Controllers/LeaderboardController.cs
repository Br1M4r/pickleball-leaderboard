using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PickleballLeaderboard.Api.Data;
using PickleballLeaderboard.Api.Dtos;
using PickleballLeaderboard.Api.Entities;
using PickleballLeaderboard.Api.Services;

namespace PickleballLeaderboard.Api.Controllers;

[ApiController]
[Route("api/leaderboard")]
public class LeaderboardController(AppDbContext db, ILeaderboardService leaderboard) : ControllerBase
{
    /// <summary>Public leaderboard. Each scope is ranked independently; filters narrow the rows shown.</summary>
    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<LeaderboardResponse>> Get(
        [FromQuery] LeaderboardScope scope = LeaderboardScope.Overall,
        [FromQuery] SkillLevel? skillLevel = null,
        [FromQuery] Gender? gender = null,
        [FromQuery] string? search = null,
        [FromQuery] string sortBy = "rank",
        [FromQuery] string sortDir = "asc",
        [FromQuery] int limit = 200,
        CancellationToken ct = default)
    {
        limit = Math.Clamp(limit, 1, 500);

        var baseQuery = db.Leaderboard.AsNoTracking().Where(e => e.Scope == scope && e.Player.IsActive);
        var totalRanked = await baseQuery.CountAsync(ct);
        var lastUpdated = await baseQuery.MaxAsync(e => (DateTime?)e.UpdatedAt, ct);

        var q = baseQuery.Include(e => e.Player).AsQueryable();
        if (skillLevel.HasValue) q = q.Where(e => e.Player.SkillLevel == skillLevel);
        if (gender.HasValue) q = q.Where(e => e.Player.Gender == gender);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search.Trim()}%";
            q = q.Where(e => EF.Functions.ILike(e.Player.FullName, term));
        }

        var desc = string.Equals(sortDir, "desc", StringComparison.OrdinalIgnoreCase);
        q = (sortBy.ToLowerInvariant(), desc) switch
        {
            ("name", false) => q.OrderBy(e => e.Player.FullName),
            ("name", true) => q.OrderByDescending(e => e.Player.FullName),
            ("points", false) => q.OrderBy(e => e.Points).ThenByDescending(e => e.Rank),
            ("points", true) => q.OrderByDescending(e => e.Points).ThenBy(e => e.Rank),
            ("wins", false) => q.OrderBy(e => e.Wins).ThenBy(e => e.Rank),
            ("wins", true) => q.OrderByDescending(e => e.Wins).ThenBy(e => e.Rank),
            ("losses", false) => q.OrderBy(e => e.Losses).ThenBy(e => e.Rank),
            ("losses", true) => q.OrderByDescending(e => e.Losses).ThenBy(e => e.Rank),
            ("matches", false) => q.OrderBy(e => e.MatchesPlayed).ThenBy(e => e.Rank),
            ("matches", true) => q.OrderByDescending(e => e.MatchesPlayed).ThenBy(e => e.Rank),
            ("winpercentage", false) => q.OrderBy(e => e.WinPercentage).ThenBy(e => e.Rank),
            ("winpercentage", true) => q.OrderByDescending(e => e.WinPercentage).ThenBy(e => e.Rank),
            ("streak", false) => q.OrderBy(e => e.CurrentWinStreak).ThenBy(e => e.Rank),
            ("streak", true) => q.OrderByDescending(e => e.CurrentWinStreak).ThenBy(e => e.Rank),
            (_, true) => q.OrderByDescending(e => e.Rank).ThenByDescending(e => e.Player.FullName),
            _ => q.OrderBy(e => e.Rank).ThenBy(e => e.Player.FullName)
        };

        var rows = await q.Take(limit).ToListAsync(ct);
        return Ok(new LeaderboardResponse(scope, lastUpdated, totalRanked, rows.Select(r => r.ToRow()).ToList()));
    }

    /// <summary>Force a full rebuild of all rankings from match history.</summary>
    [HttpPost("recalculate")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Recalculate(CancellationToken ct)
    {
        await leaderboard.RecalculateAsync(ct);
        return NoContent();
    }
}
