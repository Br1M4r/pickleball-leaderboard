using Microsoft.EntityFrameworkCore;
using PickleballLeaderboard.Api.Data;
using PickleballLeaderboard.Api.Entities;

namespace PickleballLeaderboard.Api.Services;

public interface ILeaderboardService
{
    Task RecalculateAsync(CancellationToken ct = default);
    Task<RankingRule> GetActiveRulesAsync(CancellationToken ct = default);
}

public sealed class LeaderboardService(AppDbContext db, ILogger<LeaderboardService> logger) : ILeaderboardService
{
    // Serialises recalculations within this instance so concurrent edits can't interleave.
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public async Task<RankingRule> GetActiveRulesAsync(CancellationToken ct = default)
    {
        var rules = await db.RankingRules.FirstOrDefaultAsync(r => r.IsActive, ct);
        if (rules is not null) return rules;

        rules = new RankingRule { Name = "Default", IsActive = true };
        db.RankingRules.Add(rules);
        await db.SaveChangesAsync(ct);
        return rules;
    }

    public async Task RecalculateAsync(CancellationToken ct = default)
    {
        await Gate.WaitAsync(ct);
        try
        {
            var rules = await GetActiveRulesAsync(ct);

            var raw = await db.Matches
                .AsNoTracking()
                .Where(m => m.Status == MatchStatus.Completed && m.Result != null)
                .Select(m => new
                {
                    m.Id,
                    m.PlayedAt,
                    m.MatchType,
                    m.Category,
                    m.Result!.Team1Score,
                    m.Result.Team2Score,
                    Participants = m.Participants.Select(p => new { p.PlayerId, p.Team }).ToList()
                })
                .ToListAsync(ct);

            var matches = raw.Select(m => new RankedMatch(
                m.Id,
                m.PlayedAt,
                m.MatchType,
                m.Category,
                m.Participants.Where(p => p.Team == 1).Select(p => p.PlayerId).ToList(),
                m.Participants.Where(p => p.Team == 2).Select(p => p.PlayerId).ToList(),
                m.Team1Score,
                m.Team2Score)).ToList();

            var eligible = (await db.Players
                    .Where(p => p.IsActive)
                    .Select(p => p.Id)
                    .ToListAsync(ct))
                .ToHashSet();

            var existing = await db.Leaderboard.ToListAsync(ct);
            var now = DateTime.UtcNow;

            // Join the caller's transaction when there is one (match edit + recalculation commit together).
            await using var tx = db.Database.CurrentTransaction is null
                ? await db.Database.BeginTransactionAsync(ct)
                : null;

            foreach (var scope in Enum.GetValues<LeaderboardScope>())
            {
                var standings = RankingCalculator.Calculate(scope, matches, rules, eligible);
                var current = existing.Where(e => e.Scope == scope).ToDictionary(e => e.PlayerId);

                // Only shift "previous rank" when the standings actually moved,
                // so repeated recalculations don't erase movement indicators.
                var newIds = standings.Select(s => s.PlayerId).ToHashSet();
                var standingsChanged =
                    newIds.Count != current.Count ||
                    standings.Any(s => !current.TryGetValue(s.PlayerId, out var old) || old.Rank != s.Rank);

                foreach (var s in standings)
                {
                    if (!current.TryGetValue(s.PlayerId, out var entry))
                    {
                        entry = new LeaderboardEntry { PlayerId = s.PlayerId, Scope = scope, PreviousRank = null };
                        db.Leaderboard.Add(entry);
                    }
                    else if (standingsChanged)
                    {
                        entry.PreviousRank = entry.Rank;
                    }

                    entry.Rank = s.Rank;
                    entry.Wins = s.Wins;
                    entry.Losses = s.Losses;
                    entry.MatchesPlayed = s.MatchesPlayed;
                    entry.WinPercentage = s.WinPercentage;
                    entry.Points = s.Points;
                    entry.CurrentWinStreak = s.CurrentWinStreak;
                    entry.LongestWinStreak = s.LongestWinStreak;
                    entry.PointsFor = s.PointsFor;
                    entry.PointsAgainst = s.PointsAgainst;
                    entry.LastMatchAt = s.LastMatchAt;
                    entry.UpdatedAt = now;
                }

                var stale = current.Values.Where(e => !newIds.Contains(e.PlayerId)).ToList();
                db.Leaderboard.RemoveRange(stale);
            }

            await db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);

            logger.LogInformation("Leaderboard recalculated from {Count} completed matches", matches.Count);
        }
        finally
        {
            Gate.Release();
        }
    }
}
