using PickleballLeaderboard.Api.Entities;
using PickleballLeaderboard.Api.Services;
using Xunit;

namespace PickleballLeaderboard.Tests;

public class RankingCalculatorTests
{
    private static readonly DateTime T0 = new(2026, 1, 1, 9, 0, 0, DateTimeKind.Utc);

    private static RankingRule Rules(
        int win = 3, int loss = 0, int marginThreshold = 0, int marginPoints = 0,
        int streakThreshold = 0, int streakPoints = 0, int minMatches = 1, bool allowNegative = false) =>
        new()
        {
            WinPoints = win, LossPoints = loss,
            MarginBonusThreshold = marginThreshold, MarginBonusPoints = marginPoints,
            StreakBonusThreshold = streakThreshold, StreakBonusPoints = streakPoints,
            MinMatchesToRank = minMatches, AllowNegativePoints = allowNegative
        };

    private static RankedMatch Singles(int id, int p1, int p2, int s1, int s2, int dayOffset = 0,
        MatchCategory cat = MatchCategory.Open) =>
        new(id, T0.AddDays(dayOffset == 0 ? id : dayOffset), MatchFormat.Singles, cat, [p1], [p2], s1, s2);

    private static RankedMatch Doubles(int id, int a1, int a2, int b1, int b2, int s1, int s2,
        MatchCategory cat = MatchCategory.Open) =>
        new(id, T0.AddDays(id), MatchFormat.Doubles, cat, [a1, a2], [b1, b2], s1, s2);

    private static HashSet<int> All(params int[] ids) => ids.ToHashSet();

    [Fact]
    public void Winner_gets_win_points_and_ranks_first()
    {
        var result = RankingCalculator.Calculate(LeaderboardScope.Overall,
            [Singles(1, 1, 2, 11, 7)], Rules(), All(1, 2));

        Assert.Equal(1, result[0].PlayerId);
        Assert.Equal(3, result[0].Points);
        Assert.Equal(1, result[0].Rank);
        Assert.Equal(100m, result[0].WinPercentage);
        Assert.Equal(2, result[1].Rank);
        Assert.Equal(0m, result[1].WinPercentage);
    }

    [Fact]
    public void Loss_points_can_deduct_but_floor_at_zero_unless_allowed()
    {
        var matches = new[] { Singles(1, 1, 2, 11, 3) };

        var floored = RankingCalculator.Calculate(LeaderboardScope.Overall, matches, Rules(loss: -2), All(1, 2));
        Assert.Equal(0, floored.Single(s => s.PlayerId == 2).Points);

        var negative = RankingCalculator.Calculate(LeaderboardScope.Overall, matches,
            Rules(loss: -2, allowNegative: true), All(1, 2));
        Assert.Equal(-2, negative.Single(s => s.PlayerId == 2).Points);
    }

    [Fact]
    public void Margin_and_streak_bonuses_apply()
    {
        var matches = new[]
        {
            Singles(1, 1, 2, 11, 2),  // margin 9 -> bonus
            Singles(2, 1, 3, 11, 9),  // margin 2 -> no bonus
            Singles(3, 1, 2, 11, 9),  // 3rd straight win -> streak bonus
        };
        var result = RankingCalculator.Calculate(LeaderboardScope.Overall, matches,
            Rules(win: 3, marginThreshold: 5, marginPoints: 1, streakThreshold: 3, streakPoints: 2), All(1, 2, 3));

        var p1 = result.Single(s => s.PlayerId == 1);
        Assert.Equal(3 + 1 + 3 + 3 + 2, p1.Points);
        Assert.Equal(3, p1.CurrentWinStreak);
        Assert.Equal(3, p1.LongestWinStreak);
    }

    [Fact]
    public void Streak_resets_on_loss_and_is_order_dependent()
    {
        var matches = new[]
        {
            Singles(1, 1, 2, 11, 5),
            Singles(2, 1, 2, 11, 5),
            Singles(3, 2, 1, 11, 5),
            Singles(4, 1, 2, 11, 5),
        };
        var p1 = RankingCalculator.Calculate(LeaderboardScope.Overall, matches, Rules(), All(1, 2))
            .Single(s => s.PlayerId == 1);
        Assert.Equal(1, p1.CurrentWinStreak);
        Assert.Equal(2, p1.LongestWinStreak);
        Assert.Equal(3, p1.Wins);
        Assert.Equal(1, p1.Losses);
        Assert.Equal(75m, p1.WinPercentage);
    }

    [Fact]
    public void Correcting_a_score_recalculates_consistently()
    {
        var original = new[] { Singles(1, 1, 2, 11, 9), Singles(2, 2, 3, 11, 4) };
        var corrected = new[] { Singles(1, 1, 2, 9, 11), Singles(2, 2, 3, 11, 4) };

        var before = RankingCalculator.Calculate(LeaderboardScope.Overall, original, Rules(), All(1, 2, 3));
        var after = RankingCalculator.Calculate(LeaderboardScope.Overall, corrected, Rules(), All(1, 2, 3));

        Assert.Equal(1, before.Single(s => s.PlayerId == 1).Wins);
        Assert.Equal(0, after.Single(s => s.PlayerId == 1).Wins);
        Assert.Equal(2, after.Single(s => s.PlayerId == 2).Wins);
        Assert.Equal(1, after.Single(s => s.PlayerId == 2).Rank);
    }

    [Fact]
    public void Doubles_credit_both_partners_and_scopes_filter_matches()
    {
        var matches = new[]
        {
            Doubles(1, 1, 2, 3, 4, 11, 6, MatchCategory.Mixed),
            Singles(2, 1, 3, 11, 8),
        };
        var rules = Rules();
        var ids = All(1, 2, 3, 4);

        var doubles = RankingCalculator.Calculate(LeaderboardScope.Doubles, matches, rules, ids);
        Assert.Equal(4, doubles.Count);
        Assert.All(doubles.Where(s => s.PlayerId is 1 or 2), s => Assert.Equal(1, s.Wins));

        var mixed = RankingCalculator.Calculate(LeaderboardScope.MixedDoubles, matches, rules, ids);
        Assert.Equal(4, mixed.Count);

        var singles = RankingCalculator.Calculate(LeaderboardScope.Singles, matches, rules, ids);
        Assert.Equal(2, singles.Count);

        var overall = RankingCalculator.Calculate(LeaderboardScope.Overall, matches, rules, ids);
        Assert.Equal(2, overall.Single(s => s.PlayerId == 1).MatchesPlayed);

        var mens = RankingCalculator.Calculate(LeaderboardScope.Mens, matches, rules, ids);
        Assert.Empty(mens);
    }

    [Fact]
    public void Ineligible_players_are_not_ranked_but_their_matches_count_for_opponents()
    {
        var result = RankingCalculator.Calculate(LeaderboardScope.Overall,
            [Singles(1, 1, 2, 11, 7)], Rules(), All(1));
        Assert.Single(result);
        Assert.Equal(1, result[0].Wins);
    }

    [Fact]
    public void Minimum_matches_requirement_is_respected()
    {
        var matches = new[] { Singles(1, 1, 2, 11, 7), Singles(2, 1, 3, 11, 7) };
        var result = RankingCalculator.Calculate(LeaderboardScope.Overall, matches, Rules(minMatches: 2), All(1, 2, 3));
        Assert.Single(result);
        Assert.Equal(1, result[0].PlayerId);
    }

    [Fact]
    public void Fully_tied_players_share_a_rank()
    {
        var matches = new[] { Singles(1, 1, 2, 11, 5), Singles(2, 3, 4, 11, 5), Singles(3, 5, 6, 11, 9) };
        var result = RankingCalculator.Calculate(LeaderboardScope.Overall, matches, Rules(), All(1, 2, 3, 4, 5, 6));

        Assert.Equal(1, result.Single(s => s.PlayerId == 1).Rank);
        Assert.Equal(1, result.Single(s => s.PlayerId == 3).Rank);
        Assert.Equal(3, result.Single(s => s.PlayerId == 5).Rank); // smaller point differential
        Assert.Equal(4, result.Single(s => s.PlayerId == 6).Rank);
    }
}
