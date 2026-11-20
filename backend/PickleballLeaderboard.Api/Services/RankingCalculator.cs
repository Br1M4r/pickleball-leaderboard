using PickleballLeaderboard.Api.Entities;

namespace PickleballLeaderboard.Api.Services;

/// <summary>A completed match reduced to what the ranking engine needs.</summary>
public sealed record RankedMatch(
    int MatchId,
    DateTime PlayedAt,
    MatchFormat MatchType,
    MatchCategory Category,
    IReadOnlyList<int> Team1,
    IReadOnlyList<int> Team2,
    int Team1Score,
    int Team2Score);

public sealed class PlayerStanding
{
    public int PlayerId { get; init; }
    public int Rank { get; set; }
    public int MatchesPlayed => Wins + Losses;
    public int Wins { get; set; }
    public int Losses { get; set; }
    public int Points { get; set; }
    public int CurrentWinStreak { get; set; }
    public int LongestWinStreak { get; set; }
    public int PointsFor { get; set; }
    public int PointsAgainst { get; set; }
    public DateTime? LastMatchAt { get; set; }

    public decimal WinPercentage =>
        MatchesPlayed == 0 ? 0m : Math.Round(Wins * 100m / MatchesPlayed, 2, MidpointRounding.AwayFromZero);

    public int PointDifferential => PointsFor - PointsAgainst;
}

/// <summary>
/// Pure, deterministic ranking engine. Rankings are always rebuilt from the full match
/// history in chronological order, so corrections to old matches produce the same result
/// as if the corrected score had been entered originally.
/// </summary>
public static class RankingCalculator
{
    public static bool IsInScope(LeaderboardScope scope, MatchFormat type, MatchCategory category) => scope switch
    {
        LeaderboardScope.Overall => true,
        LeaderboardScope.Singles => type == MatchFormat.Singles,
        LeaderboardScope.Doubles => type == MatchFormat.Doubles,
        LeaderboardScope.Mens => category == MatchCategory.Mens,
        LeaderboardScope.Womens => category == MatchCategory.Womens,
        LeaderboardScope.MixedDoubles => type == MatchFormat.Doubles && category == MatchCategory.Mixed,
        _ => false
    };

    /// <param name="eligiblePlayerIds">Only these players are ranked (e.g. active players).
    /// Matches against ineligible players still count for the eligible side.</param>
    public static List<PlayerStanding> Calculate(
        LeaderboardScope scope,
        IEnumerable<RankedMatch> matches,
        RankingRule rules,
        IReadOnlySet<int> eligiblePlayerIds)
    {
        var table = new Dictionary<int, PlayerStanding>();

        PlayerStanding Get(int id)
        {
            if (!table.TryGetValue(id, out var s))
            {
                s = new PlayerStanding { PlayerId = id };
                table[id] = s;
            }
            return s;
        }

        var ordered = matches
            .Where(m => IsInScope(scope, m.MatchType, m.Category))
            .OrderBy(m => m.PlayedAt)
            .ThenBy(m => m.MatchId);

        foreach (var m in ordered)
        {
            var team1Won = m.Team1Score > m.Team2Score;
            var margin = Math.Abs(m.Team1Score - m.Team2Score);

            Apply(m.Team1, team1Won, m.Team1Score, m.Team2Score);
            Apply(m.Team2, !team1Won, m.Team2Score, m.Team1Score);

            void Apply(IReadOnlyList<int> team, bool won, int scored, int conceded)
            {
                foreach (var playerId in team)
                {
                    var s = Get(playerId);
                    s.PointsFor += scored;
                    s.PointsAgainst += conceded;
                    s.LastMatchAt = m.PlayedAt;

                    if (won)
                    {
                        s.Wins++;
                        s.CurrentWinStreak++;
                        s.LongestWinStreak = Math.Max(s.LongestWinStreak, s.CurrentWinStreak);
                        s.Points += rules.WinPoints;

                        if (rules.MarginBonusThreshold > 0 && margin >= rules.MarginBonusThreshold)
                            s.Points += rules.MarginBonusPoints;

                        if (rules.StreakBonusThreshold > 0 && s.CurrentWinStreak % rules.StreakBonusThreshold == 0)
                            s.Points += rules.StreakBonusPoints;
                    }
                    else
                    {
                        s.Losses++;
                        s.CurrentWinStreak = 0;
                        s.Points += rules.LossPoints;
                    }

                    if (!rules.AllowNegativePoints && s.Points < 0)
                        s.Points = 0;
                }
            }
        }

        var minMatches = Math.Max(1, rules.MinMatchesToRank);

        var ranked = table.Values
            .Where(s => eligiblePlayerIds.Contains(s.PlayerId) && s.MatchesPlayed >= minMatches)
            .OrderByDescending(s => s.Points)
            .ThenByDescending(s => s.WinPercentage)
            .ThenByDescending(s => s.Wins)
            .ThenByDescending(s => s.PointDifferential)
            .ThenBy(s => s.PlayerId)
            .ToList();

        // Standard competition ranking (1, 2, 2, 4): fully tied players share a rank.
        for (var i = 0; i < ranked.Count; i++)
        {
            var current = ranked[i];
            if (i > 0 && IsTie(ranked[i - 1], current))
                current.Rank = ranked[i - 1].Rank;
            else
                current.Rank = i + 1;
        }

        return ranked;
    }

    private static bool IsTie(PlayerStanding a, PlayerStanding b) =>
        a.Points == b.Points &&
        a.WinPercentage == b.WinPercentage &&
        a.Wins == b.Wins &&
        a.PointDifferential == b.PointDifferential;
}
