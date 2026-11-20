namespace PickleballLeaderboard.Api.Entities;

public enum UserRole
{
    Player,
    Admin
}

public enum Gender
{
    Male,
    Female,
    Other
}

public enum SkillLevel
{
    Beginner,
    Intermediate,
    Advanced,
    Pro
}

public enum PlayingCategory
{
    Singles,
    Doubles,
    Both
}

public enum MatchFormat
{
    Singles,
    Doubles
}

/// <summary>Division a match is played in. Mixed is only valid for doubles.</summary>
public enum MatchCategory
{
    Open,
    Mens,
    Womens,
    Mixed
}

public enum MatchStatus
{
    Scheduled,
    Completed,
    Cancelled
}

/// <summary>Each scope is an independent ranking table.</summary>
public enum LeaderboardScope
{
    Overall,
    Singles,
    Doubles,
    Mens,
    Womens,
    MixedDoubles
}

public enum MatchHistoryAction
{
    MatchCreated,
    MatchUpdated,
    ResultRecorded,
    ResultCorrected,
    MatchCancelled,
    MatchRestored
}
