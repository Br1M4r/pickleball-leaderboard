using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PickleballLeaderboard.Api.Data;
using PickleballLeaderboard.Api.Dtos;
using PickleballLeaderboard.Api.Entities;
using PickleballLeaderboard.Api.Services;

namespace PickleballLeaderboard.Api.Controllers;

[ApiController]
[Route("api/dashboard")]
[Authorize(Roles = "Admin")]
public class DashboardController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<DashboardDto>> Get(CancellationToken ct)
    {
        var totalPlayers = await db.Players.CountAsync(ct);
        var activePlayers = await db.Players.CountAsync(p => p.IsActive, ct);

        var completed = db.Matches.Where(m => m.Status == MatchStatus.Completed && m.Result != null);
        var totalMatches = await completed.CountAsync(ct);
        var singles = await completed.CountAsync(m => m.MatchType == MatchFormat.Singles, ct);
        var doubles = totalMatches - singles;
        var scheduled = await db.Matches.CountAsync(m => m.Status == MatchStatus.Scheduled, ct);

        var participantResults = db.MatchParticipants
            .Where(p => p.Match.Status == MatchStatus.Completed && p.Match.Result != null);
        var totalWins = await participantResults.CountAsync(p => p.Team == p.Match.Result!.WinningTeam, ct);
        var totalLosses = await participantResults.CountAsync(p => p.Team != p.Match.Result!.WinningTeam, ct);

        var overall = db.Leaderboard.AsNoTracking().Include(e => e.Player)
            .Where(e => e.Scope == LeaderboardScope.Overall && e.Player.IsActive);

        var top = await overall.OrderBy(e => e.Rank).Take(5).ToListAsync(ct);
        var bestRates = await overall.Where(e => e.MatchesPlayed >= 3)
            .OrderByDescending(e => e.WinPercentage).ThenByDescending(e => e.Wins).Take(5).ToListAsync(ct);
        var streaks = await overall.Where(e => e.CurrentWinStreak > 0)
            .OrderByDescending(e => e.CurrentWinStreak).ThenBy(e => e.Rank).Take(5).ToListAsync(ct);

        var recent = await db.Matches.AsNoTracking().WithDetails()
            .Where(m => m.Status == MatchStatus.Completed)
            .OrderByDescending(m => m.PlayedAt).ThenByDescending(m => m.Id)
            .Take(8)
            .ToListAsync(ct);

        var skillCounts = await db.Players.Where(p => p.IsActive)
            .GroupBy(p => p.SkillLevel)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var skillDistribution = Enum.GetValues<SkillLevel>()
            .Select(s => new CountByLabel(s.ToString(), skillCounts.FirstOrDefault(x => x.Key == s)?.Count ?? 0))
            .ToList();

        var now = DateTime.UtcNow;
        var start = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(-5);
        var dates = await completed.Where(m => m.PlayedAt >= start).Select(m => m.PlayedAt).ToListAsync(ct);
        var perMonth = Enumerable.Range(0, 6)
            .Select(i => start.AddMonths(i))
            .Select(month => new CountByLabel(
                month.ToString("MMM yyyy", CultureInfo.InvariantCulture),
                dates.Count(d => d.Year == month.Year && d.Month == month.Month)))
            .ToList();

        return Ok(new DashboardDto(
            totalPlayers, activePlayers, totalMatches, scheduled, singles, doubles, totalWins, totalLosses,
            top.Select(e => e.ToRow()).ToList(),
            bestRates.Select(e => e.ToRow()).ToList(),
            streaks.Select(e => e.ToRow()).ToList(),
            recent.Select(m => m.ToDto()).ToList(),
            skillDistribution,
            perMonth));
    }
}
