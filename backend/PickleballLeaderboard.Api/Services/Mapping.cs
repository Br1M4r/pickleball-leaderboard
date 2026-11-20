using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using PickleballLeaderboard.Api.Dtos;
using PickleballLeaderboard.Api.Entities;

namespace PickleballLeaderboard.Api.Services;

public static class Mapping
{
    private static readonly JsonSerializerOptions SnapshotJson = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() }
    };

    public static string? PhotoUrl(Player p) =>
        p.PhotoUpdatedAt is null ? null : $"/api/players/{p.Id}/photo?v={p.PhotoUpdatedAt.Value.Ticks}";

    public static PlayerDto ToDto(this Player p, bool includeAccount = false) => new(
        p.Id,
        p.FullName,
        p.Gender,
        p.Age,
        p.SkillLevel,
        p.PlayingCategory,
        p.DateRegistered,
        p.IsActive,
        PhotoUrl(p),
        includeAccount ? p.UserId : null,
        includeAccount ? p.User?.Email : null);

    public static UserDto ToDto(this User u) => new(
        u.Id, u.Email, u.Role, u.IsActive, u.Player?.Id, u.Player?.FullName, u.CreatedAt, u.LastLoginAt);

    public static MatchDto ToDto(this Match m)
    {
        ParticipantDto P(MatchParticipant x) =>
            new(x.PlayerId, x.Player?.FullName ?? "Unknown", x.Player is null ? null : PhotoUrl(x.Player), x.Team,
                x.Player?.Gender ?? Gender.Other);

        return new MatchDto(
            m.Id,
            m.MatchType,
            m.Category,
            m.Status,
            m.PlayedAt,
            m.Location,
            m.Notes,
            m.Participants.Where(x => x.Team == 1).OrderBy(x => x.Id).Select(P).ToList(),
            m.Participants.Where(x => x.Team == 2).OrderBy(x => x.Id).Select(P).ToList(),
            m.Result is null
                ? null
                : new MatchResultDto(m.Result.Team1Score, m.Result.Team2Score, m.Result.WinningTeam,
                    m.Result.RecordedAt, m.Result.UpdatedAt),
            m.CreatedAt,
            m.UpdatedAt);
    }

    public static LeaderboardRowDto ToRow(this LeaderboardEntry e) => new(
        e.Scope,
        e.Rank,
        e.PreviousRank,
        e.PreviousRank.HasValue ? e.PreviousRank.Value - e.Rank : null,
        e.PlayerId,
        e.Player.FullName,
        PhotoUrl(e.Player),
        e.Player.Gender,
        e.Player.SkillLevel,
        e.MatchesPlayed,
        e.Wins,
        e.Losses,
        e.WinPercentage,
        e.Points,
        e.CurrentWinStreak,
        e.LongestWinStreak,
        e.PointsFor,
        e.PointsAgainst,
        e.LastMatchAt);

    public static RankingRuleDto ToDto(this RankingRule r) => new(
        r.Id, r.Name, r.WinPoints, r.LossPoints, r.MarginBonusThreshold, r.MarginBonusPoints,
        r.StreakBonusThreshold, r.StreakBonusPoints, r.MinMatchesToRank, r.AllowNegativePoints, r.UpdatedAt);

    /// <summary>JSON snapshot of a match used in the audit history.</summary>
    public static string Snapshot(this Match m) => JsonSerializer.Serialize(new
    {
        m.MatchType,
        m.Category,
        m.Status,
        m.PlayedAt,
        m.Location,
        m.Notes,
        Team1 = m.Participants.Where(x => x.Team == 1)
            .Select(x => new { x.PlayerId, Name = x.Player?.FullName }).ToList(),
        Team2 = m.Participants.Where(x => x.Team == 2)
            .Select(x => new { x.PlayerId, Name = x.Player?.FullName }).ToList(),
        Result = m.Result is null
            ? null
            : new { m.Result.Team1Score, m.Result.Team2Score, m.Result.WinningTeam }
    }, SnapshotJson);

    public static IQueryable<Match> WithDetails(this IQueryable<Match> q) =>
        q.Include(m => m.Participants).ThenInclude(p => p.Player)
         .Include(m => m.Result)
         .AsSplitQuery();
}
