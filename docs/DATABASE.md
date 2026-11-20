# Database design (Neon PostgreSQL)

The schema is defined in `backend/PickleballLeaderboard.Api/Data/AppDbContext.cs` and is created automatically. Enums are stored as readable strings (e.g. `'Doubles'`, `'Mixed'`), and all timestamps are `timestamptz` (UTC).

## Tables

### Users
Login accounts.
| Column | Type | Notes |
|---|---|---|
| Id | serial PK | |
| Email | varchar(256) | **unique**, stored lowercase |
| PasswordHash | varchar(512) | PBKDF2 hash |
| Role | varchar(20) | `Admin` / `Player` |
| IsActive | bool | inactive users cannot sign in |
| CreatedAt, LastLoginAt | timestamptz | |

### Players
Player profiles. A player may exist without a login.
| Column | Type | Notes |
|---|---|---|
| Id | serial PK | |
| UserId | int FK → Users (SET NULL) | **unique** (1:1) |
| FullName | varchar(120) | indexed |
| Gender | varchar(10) | `Male` / `Female` / `Other` |
| Age | int | CHECK 5–120 |
| SkillLevel | varchar(20) | `Beginner` / `Intermediate` / `Advanced` / `Pro` |
| PlayingCategory | varchar(20) | `Singles` / `Doubles` / `Both` |
| DateRegistered, UpdatedAt | timestamptz | |
| IsActive | bool | composite index (IsActive, SkillLevel, Gender) |
| PhotoUpdatedAt | timestamptz null | cache-busting for profile pictures |

### PlayerPhotos
Profile pictures, kept separate so player queries never load image bytes.
| PlayerId PK/FK → Players (CASCADE) | Data bytea | ContentType | UpdatedAt |

### Matches
| Column | Type | Notes |
|---|---|---|
| Id | serial PK | |
| MatchType | varchar(10) | `Singles` / `Doubles` |
| Category | varchar(10) | `Open` / `Mens` / `Womens` / `Mixed`. CHECK: Mixed ⇒ Doubles |
| Status | varchar(12) | `Scheduled` / `Completed` / `Cancelled` |
| PlayedAt | timestamptz | indexed; also (Status, PlayedAt) |
| Location, Notes | varchar | |
| CreatedByUserId | FK → Users (RESTRICT) | |
| CreatedAt, UpdatedAt | timestamptz | |

### MatchParticipants
| Id PK | MatchId FK → Matches (CASCADE) | PlayerId FK → Players (RESTRICT) | Team int CHECK IN (1,2) |
- **Unique (MatchId, PlayerId)**, so a player can appear only once per match. Index on PlayerId for match-history lookups.

### MatchResults
| Column | Notes |
|---|---|
| MatchId | FK → Matches (CASCADE), **unique** (one result per match) |
| Team1Score, Team2Score | CHECK ≥ 0, CHECK Team1Score ≠ Team2Score (no ties) |
| WinningTeam | CHECK IN (1,2) |
| RecordedByUserId, RecordedAt | who first recorded it |
| UpdatedByUserId, UpdatedAt | last correction |

### MatchResultHistory
Append-only audit log of every change to a match or result.
| Column | Notes |
|---|---|
| Id | bigserial PK |
| MatchId | FK → Matches; index (MatchId, ChangedAt) |
| Action | `MatchCreated`, `MatchUpdated`, `ResultRecorded`, `ResultCorrected`, `MatchCancelled`, `MatchRestored` |
| ChangedByUserId | FK → Users |
| Reason | required for corrections |
| PreviousValues, NewValues | **jsonb** snapshots (players, scores, status…) |

### Leaderboard
Materialised standings, rebuilt by the ranking engine.
| Column | Notes |
|---|---|
| PlayerId + Scope | **unique**. Scope = `Overall`, `Singles`, `Doubles`, `Mens`, `Womens`, `MixedDoubles` |
| Rank, PreviousRank | indexed (Scope, Rank). PreviousRank drives the ▲/▼ indicators |
| MatchesPlayed, Wins, Losses | CHECK MatchesPlayed = Wins + Losses |
| WinPercentage | numeric(5,2) |
| Points, CurrentWinStreak, LongestWinStreak | |
| PointsFor, PointsAgainst, LastMatchAt, UpdatedAt | |

### RankingRules
Configurable scoring. A **partial unique index** on `IsActive WHERE IsActive = TRUE` guarantees exactly one active rule set.
| WinPoints | LossPoints | MarginBonusThreshold | MarginBonusPoints | StreakBonusThreshold | StreakBonusPoints | MinMatchesToRank | AllowNegativePoints | IsActive | UpdatedAt | UpdatedByUserId |

## Relationships

```
Users 1───0..1 Players 1───* MatchParticipants *───1 Matches 1───0..1 MatchResults
  │                 │                                   │
  │                 └───* Leaderboard                   └───* MatchResultHistory
  └── created/recorded/changed by (Matches, MatchResults, MatchResultHistory)
Players 1───0..1 PlayerPhotos
RankingRules (single active row)
```
