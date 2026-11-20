namespace PickleballLeaderboard.Api.Entities;

public class User
{
    public int Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public UserRole Role { get; set; } = UserRole.Player;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }

    public Player? Player { get; set; }
}

public class Player
{
    public int Id { get; set; }
    public int? UserId { get; set; }
    public User? User { get; set; }

    public string FullName { get; set; } = string.Empty;
    public Gender Gender { get; set; }
    public int Age { get; set; }
    public SkillLevel SkillLevel { get; set; }
    public PlayingCategory PlayingCategory { get; set; }
    public DateTime DateRegistered { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public bool IsActive { get; set; } = true;

    /// <summary>Set when a profile picture exists; used for cache busting.</summary>
    public DateTime? PhotoUpdatedAt { get; set; }

    public PlayerPhoto? Photo { get; set; }
    public ICollection<MatchParticipant> Participations { get; set; } = new List<MatchParticipant>();
    public ICollection<LeaderboardEntry> LeaderboardEntries { get; set; } = new List<LeaderboardEntry>();
}

/// <summary>Profile pictures live in their own table so player queries never load image bytes.</summary>
public class PlayerPhoto
{
    public int PlayerId { get; set; }
    public Player Player { get; set; } = null!;
    public byte[] Data { get; set; } = Array.Empty<byte>();
    public string ContentType { get; set; } = "image/jpeg";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class Match
{
    public int Id { get; set; }
    public MatchFormat MatchType { get; set; }
    public MatchCategory Category { get; set; }
    public MatchStatus Status { get; set; } = MatchStatus.Scheduled;
    public DateTime PlayedAt { get; set; }
    public string? Location { get; set; }
    public string? Notes { get; set; }

    public int CreatedByUserId { get; set; }
    public User CreatedBy { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<MatchParticipant> Participants { get; set; } = new List<MatchParticipant>();
    public MatchResult? Result { get; set; }
    public ICollection<MatchResultHistory> History { get; set; } = new List<MatchResultHistory>();
}

public class MatchParticipant
{
    public int Id { get; set; }
    public int MatchId { get; set; }
    public Match Match { get; set; } = null!;
    public int PlayerId { get; set; }
    public Player Player { get; set; } = null!;

    /// <summary>1 or 2.</summary>
    public int Team { get; set; }
}

public class MatchResult
{
    public int Id { get; set; }
    public int MatchId { get; set; }
    public Match Match { get; set; } = null!;

    public int Team1Score { get; set; }
    public int Team2Score { get; set; }
    public int WinningTeam { get; set; }

    public int RecordedByUserId { get; set; }
    public User RecordedBy { get; set; } = null!;
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;

    public int? UpdatedByUserId { get; set; }
    public User? UpdatedBy { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

/// <summary>Immutable audit trail of every change to a match or its result.</summary>
public class MatchResultHistory
{
    public long Id { get; set; }
    public int MatchId { get; set; }
    public Match Match { get; set; } = null!;
    public MatchHistoryAction Action { get; set; }
    public int ChangedByUserId { get; set; }
    public User ChangedBy { get; set; } = null!;
    public DateTime ChangedAt { get; set; } = DateTime.UtcNow;
    public string? Reason { get; set; }

    /// <summary>JSON snapshot (jsonb) before the change.</summary>
    public string? PreviousValues { get; set; }

    /// <summary>JSON snapshot (jsonb) after the change.</summary>
    public string? NewValues { get; set; }
}

public class LeaderboardEntry
{
    public int Id { get; set; }
    public int PlayerId { get; set; }
    public Player Player { get; set; } = null!;
    public LeaderboardScope Scope { get; set; }

    public int Rank { get; set; }
    public int? PreviousRank { get; set; }
    public int MatchesPlayed { get; set; }
    public int Wins { get; set; }
    public int Losses { get; set; }
    public decimal WinPercentage { get; set; }
    public int Points { get; set; }
    public int CurrentWinStreak { get; set; }
    public int LongestWinStreak { get; set; }
    public int PointsFor { get; set; }
    public int PointsAgainst { get; set; }
    public DateTime? LastMatchAt { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Configurable ranking rules. Exactly one row is active at a time.</summary>
public class RankingRule
{
    public int Id { get; set; }
    public string Name { get; set; } = "Default";

    /// <summary>Ranking points awarded for a win.</summary>
    public int WinPoints { get; set; } = 3;

    /// <summary>Ranking points for a loss. Use a negative number to deduct points.</summary>
    public int LossPoints { get; set; } = 0;

    /// <summary>Win by at least this many game points to earn the margin bonus (0 = disabled).</summary>
    public int MarginBonusThreshold { get; set; } = 5;
    public int MarginBonusPoints { get; set; } = 1;

    /// <summary>Every N consecutive wins earns the streak bonus (0 = disabled).</summary>
    public int StreakBonusThreshold { get; set; } = 3;
    public int StreakBonusPoints { get; set; } = 1;

    /// <summary>Players need at least this many matches in a scope to be ranked.</summary>
    public int MinMatchesToRank { get; set; } = 1;

    /// <summary>When false, a player's points never drop below zero.</summary>
    public bool AllowNegativePoints { get; set; } = false;

    public bool IsActive { get; set; } = true;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public int? UpdatedByUserId { get; set; }
}
