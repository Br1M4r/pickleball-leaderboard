using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using PickleballLeaderboard.Api.Entities;

namespace PickleballLeaderboard.Api.Dtos;

// ===================== Common =====================

public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount)
{
    public int TotalPages => PageSize == 0 ? 0 : (int)Math.Ceiling(TotalCount / (double)PageSize);
}

// ===================== Auth =====================

public class LoginRequest
{
    [Required, EmailAddress, MaxLength(256)]
    public string Email { get; set; } = string.Empty;

    [Required, MaxLength(128)]
    public string Password { get; set; } = string.Empty;
}

public class PlayerProfileFields
{
    [Required, StringLength(120, MinimumLength = 2)]
    public string FullName { get; set; } = string.Empty;

    [Required]
    public Gender? Gender { get; set; }

    [Required, Range(5, 120)]
    public int? Age { get; set; }

    [Required]
    public SkillLevel? SkillLevel { get; set; }

    [Required]
    public PlayingCategory? PlayingCategory { get; set; }
}

public class RegisterRequest : PlayerProfileFields
{
    [Required, EmailAddress, MaxLength(256)]
    public string Email { get; set; } = string.Empty;

    [Required, StringLength(128, MinimumLength = 8)]
    public string Password { get; set; } = string.Empty;
}

public class ChangePasswordRequest
{
    [Required]
    public string CurrentPassword { get; set; } = string.Empty;

    [Required, StringLength(128, MinimumLength = 8)]
    public string NewPassword { get; set; } = string.Empty;
}

public record UserDto(
    int Id,
    string Email,
    UserRole Role,
    bool IsActive,
    int? PlayerId,
    string? PlayerName,
    DateTime CreatedAt,
    DateTime? LastLoginAt);

public record AuthResponse(string Token, DateTime ExpiresAt, UserDto User);

// ===================== Users (admin) =====================

public class AdminCreateUserRequest
{
    [Required, EmailAddress, MaxLength(256)]
    public string Email { get; set; } = string.Empty;

    [Required, StringLength(128, MinimumLength = 8)]
    public string Password { get; set; } = string.Empty;

    [Required]
    public UserRole? Role { get; set; }

    /// <summary>Optionally link the new account to an existing player without an account.</summary>
    public int? PlayerId { get; set; }
}

public class AdminUpdateUserRequest
{
    [Required, EmailAddress, MaxLength(256)]
    public string Email { get; set; } = string.Empty;

    [Required]
    public UserRole? Role { get; set; }

    public bool IsActive { get; set; } = true;
}

public class ResetPasswordRequest
{
    [Required, StringLength(128, MinimumLength = 8)]
    public string NewPassword { get; set; } = string.Empty;
}

// ===================== Players =====================

public class PlayerUpsertRequest : PlayerProfileFields
{
}

/// <summary>Fields a player may change on their own profile.</summary>
public class SelfUpdatePlayerRequest
{
    [Required, StringLength(120, MinimumLength = 2)]
    public string FullName { get; set; } = string.Empty;

    [Required, Range(5, 120)]
    public int? Age { get; set; }

    [Required]
    public PlayingCategory? PlayingCategory { get; set; }
}

public class AdminCreatePlayerRequest : PlayerProfileFields
{
    /// <summary>Optional: create a login for the player at the same time.</summary>
    [EmailAddress, MaxLength(256)]
    public string? Email { get; set; }

    [StringLength(128, MinimumLength = 8)]
    public string? Password { get; set; }
}

public class SetActiveRequest
{
    public bool IsActive { get; set; }
}

public record PlayerDto(
    int Id,
    string FullName,
    Gender Gender,
    int Age,
    SkillLevel SkillLevel,
    PlayingCategory PlayingCategory,
    DateTime DateRegistered,
    bool IsActive,
    string? PhotoUrl,
    int? UserId,
    string? Email);

public record PlayerDetailDto(
    PlayerDto Player,
    IReadOnlyList<LeaderboardRowDto> Standings,
    IReadOnlyList<MatchDto> RecentMatches,
    PlayerTotalsDto Totals);

public record PlayerTotalsDto(
    int MatchesPlayed,
    int Wins,
    int Losses,
    decimal WinPercentage,
    int PointsFor,
    int PointsAgainst,
    int CurrentWinStreak,
    int LongestWinStreak);

// ===================== Matches =====================

public class ScoreInput
{
    [Required, Range(0, 99)]
    public int? Team1Score { get; set; }

    [Required, Range(0, 99)]
    public int? Team2Score { get; set; }
}

public class MatchUpsertRequest
{
    [Required]
    public MatchFormat? MatchType { get; set; }

    [Required]
    public MatchCategory? Category { get; set; }

    [Required]
    public DateTime? PlayedAt { get; set; }

    [MaxLength(150)]
    public string? Location { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }

    [Required, MinLength(1), MaxLength(2)]
    public List<int> Team1PlayerIds { get; set; } = new();

    [Required, MinLength(1), MaxLength(2)]
    public List<int> Team2PlayerIds { get; set; } = new();

    /// <summary>Optional: record the result while creating the match.</summary>
    public ScoreInput? Result { get; set; }

    /// <summary>Required when editing a match that already has a result.</summary>
    [MaxLength(500)]
    public string? Reason { get; set; }
}

public class RecordResultRequest : ScoreInput
{
    /// <summary>Required when correcting an existing result.</summary>
    [MaxLength(500)]
    public string? Reason { get; set; }
}

public class ReasonRequest
{
    [MaxLength(500)]
    public string? Reason { get; set; }
}

public record ParticipantDto(int PlayerId, string FullName, string? PhotoUrl, int Team, Gender Gender);

public record MatchResultDto(int Team1Score, int Team2Score, int WinningTeam, DateTime RecordedAt, DateTime? UpdatedAt);

public record MatchDto(
    int Id,
    MatchFormat MatchType,
    MatchCategory Category,
    MatchStatus Status,
    DateTime PlayedAt,
    string? Location,
    string? Notes,
    IReadOnlyList<ParticipantDto> Team1,
    IReadOnlyList<ParticipantDto> Team2,
    MatchResultDto? Result,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record MatchHistoryDto(
    long Id,
    MatchHistoryAction Action,
    DateTime ChangedAt,
    string ChangedBy,
    string? Reason,
    JsonElement? PreviousValues,
    JsonElement? NewValues);

// ===================== Leaderboard =====================

public record LeaderboardRowDto(
    LeaderboardScope Scope,
    int Rank,
    int? PreviousRank,
    int? Movement,
    int PlayerId,
    string FullName,
    string? PhotoUrl,
    Gender Gender,
    SkillLevel SkillLevel,
    int MatchesPlayed,
    int Wins,
    int Losses,
    decimal WinPercentage,
    int Points,
    int CurrentWinStreak,
    int LongestWinStreak,
    int PointsFor,
    int PointsAgainst,
    DateTime? LastMatchAt);

public record LeaderboardResponse(
    LeaderboardScope Scope,
    DateTime? LastUpdated,
    int TotalRanked,
    IReadOnlyList<LeaderboardRowDto> Rows);

// ===================== Ranking rules =====================

public class RankingRuleRequest
{
    [Required, StringLength(80, MinimumLength = 1)]
    public string Name { get; set; } = "Default";

    [Range(0, 100)] public int WinPoints { get; set; }
    [Range(-100, 100)] public int LossPoints { get; set; }
    [Range(0, 99)] public int MarginBonusThreshold { get; set; }
    [Range(0, 100)] public int MarginBonusPoints { get; set; }
    [Range(0, 50)] public int StreakBonusThreshold { get; set; }
    [Range(0, 100)] public int StreakBonusPoints { get; set; }
    [Range(1, 100)] public int MinMatchesToRank { get; set; } = 1;
    public bool AllowNegativePoints { get; set; }
}

public record RankingRuleDto(
    int Id,
    string Name,
    int WinPoints,
    int LossPoints,
    int MarginBonusThreshold,
    int MarginBonusPoints,
    int StreakBonusThreshold,
    int StreakBonusPoints,
    int MinMatchesToRank,
    bool AllowNegativePoints,
    DateTime UpdatedAt);

// ===================== Dashboard =====================

public record CountByLabel(string Label, int Count);

public record DashboardDto(
    int TotalPlayers,
    int ActivePlayers,
    int TotalMatches,
    int ScheduledMatches,
    int SinglesMatches,
    int DoublesMatches,
    int TotalWins,
    int TotalLosses,
    IReadOnlyList<LeaderboardRowDto> TopPlayers,
    IReadOnlyList<LeaderboardRowDto> BestWinRates,
    IReadOnlyList<LeaderboardRowDto> HottestStreaks,
    IReadOnlyList<MatchDto> RecentMatches,
    IReadOnlyList<CountByLabel> SkillDistribution,
    IReadOnlyList<CountByLabel> MatchesPerMonth);
