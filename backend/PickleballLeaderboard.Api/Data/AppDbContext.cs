using Microsoft.EntityFrameworkCore;
using PickleballLeaderboard.Api.Entities;

namespace PickleballLeaderboard.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Player> Players => Set<Player>();
    public DbSet<PlayerPhoto> PlayerPhotos => Set<PlayerPhoto>();
    public DbSet<Match> Matches => Set<Match>();
    public DbSet<MatchParticipant> MatchParticipants => Set<MatchParticipant>();
    public DbSet<MatchResult> MatchResults => Set<MatchResult>();
    public DbSet<MatchResultHistory> MatchResultHistory => Set<MatchResultHistory>();
    public DbSet<LeaderboardEntry> Leaderboard => Set<LeaderboardEntry>();
    public DbSet<RankingRule> RankingRules => Set<RankingRule>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // ---------- Users ----------
        b.Entity<User>(e =>
        {
            e.ToTable("Users");
            e.HasKey(x => x.Id);
            e.Property(x => x.Email).HasMaxLength(256).IsRequired();
            e.Property(x => x.PasswordHash).HasMaxLength(512).IsRequired();
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.Email).IsUnique();
        });

        // ---------- Players ----------
        b.Entity<Player>(e =>
        {
            e.ToTable("Players", t =>
            {
                t.HasCheckConstraint("CK_Players_Age", "\"Age\" BETWEEN 5 AND 120");
            });
            e.HasKey(x => x.Id);
            e.Property(x => x.FullName).HasMaxLength(120).IsRequired();
            e.Property(x => x.Gender).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.SkillLevel).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.PlayingCategory).HasConversion<string>().HasMaxLength(20);
            e.HasOne(x => x.User).WithOne(u => u.Player)
                .HasForeignKey<Player>(x => x.UserId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => x.UserId).IsUnique();
            e.HasIndex(x => x.FullName);
            e.HasIndex(x => new { x.IsActive, x.SkillLevel, x.Gender });
        });

        b.Entity<PlayerPhoto>(e =>
        {
            e.ToTable("PlayerPhotos");
            e.HasKey(x => x.PlayerId);
            e.Property(x => x.ContentType).HasMaxLength(50).IsRequired();
            e.HasOne(x => x.Player).WithOne(p => p.Photo)
                .HasForeignKey<PlayerPhoto>(x => x.PlayerId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // ---------- Matches ----------
        b.Entity<Match>(e =>
        {
            e.ToTable("Matches", t =>
            {
                t.HasCheckConstraint("CK_Matches_MixedIsDoubles",
                    "\"Category\" <> 'Mixed' OR \"MatchType\" = 'Doubles'");
            });
            e.HasKey(x => x.Id);
            e.Property(x => x.MatchType).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Category).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(12);
            e.Property(x => x.Location).HasMaxLength(150);
            e.Property(x => x.Notes).HasMaxLength(1000);
            e.HasOne(x => x.CreatedBy).WithMany()
                .HasForeignKey(x => x.CreatedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.Status, x.PlayedAt });
            e.HasIndex(x => x.PlayedAt);
        });

        b.Entity<MatchParticipant>(e =>
        {
            e.ToTable("MatchParticipants", t =>
            {
                t.HasCheckConstraint("CK_MatchParticipants_Team", "\"Team\" IN (1, 2)");
            });
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Match).WithMany(m => m.Participants)
                .HasForeignKey(x => x.MatchId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Player).WithMany(p => p.Participations)
                .HasForeignKey(x => x.PlayerId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.MatchId, x.PlayerId }).IsUnique();
            e.HasIndex(x => x.PlayerId);
        });

        b.Entity<MatchResult>(e =>
        {
            e.ToTable("MatchResults", t =>
            {
                t.HasCheckConstraint("CK_MatchResults_Scores", "\"Team1Score\" >= 0 AND \"Team2Score\" >= 0");
                t.HasCheckConstraint("CK_MatchResults_NoTie", "\"Team1Score\" <> \"Team2Score\"");
                t.HasCheckConstraint("CK_MatchResults_Winner", "\"WinningTeam\" IN (1, 2)");
            });
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Match).WithOne(m => m.Result)
                .HasForeignKey<MatchResult>(x => x.MatchId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.RecordedBy).WithMany()
                .HasForeignKey(x => x.RecordedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.UpdatedBy).WithMany()
                .HasForeignKey(x => x.UpdatedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.MatchId).IsUnique();
        });

        b.Entity<MatchResultHistory>(e =>
        {
            e.ToTable("MatchResultHistory");
            e.HasKey(x => x.Id);
            e.Property(x => x.Action).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.Reason).HasMaxLength(500);
            e.Property(x => x.PreviousValues).HasColumnType("jsonb");
            e.Property(x => x.NewValues).HasColumnType("jsonb");
            e.HasOne(x => x.Match).WithMany(m => m.History)
                .HasForeignKey(x => x.MatchId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.ChangedBy).WithMany()
                .HasForeignKey(x => x.ChangedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.MatchId, x.ChangedAt });
        });

        // ---------- Leaderboard ----------
        b.Entity<LeaderboardEntry>(e =>
        {
            e.ToTable("Leaderboard", t =>
            {
                t.HasCheckConstraint("CK_Leaderboard_Counts",
                    "\"Wins\" >= 0 AND \"Losses\" >= 0 AND \"MatchesPlayed\" = \"Wins\" + \"Losses\"");
            });
            e.HasKey(x => x.Id);
            e.Property(x => x.Scope).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.WinPercentage).HasPrecision(5, 2);
            e.HasOne(x => x.Player).WithMany(p => p.LeaderboardEntries)
                .HasForeignKey(x => x.PlayerId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.PlayerId, x.Scope }).IsUnique();
            e.HasIndex(x => new { x.Scope, x.Rank });
        });

        // ---------- Ranking rules ----------
        b.Entity<RankingRule>(e =>
        {
            e.ToTable("RankingRules", t =>
            {
                t.HasCheckConstraint("CK_RankingRules_NonNegative",
                    "\"WinPoints\" >= 0 AND \"MarginBonusThreshold\" >= 0 AND \"StreakBonusThreshold\" >= 0 AND \"MinMatchesToRank\" >= 1");
            });
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(80).IsRequired();
            // Only one active rule set at a time.
            e.HasIndex(x => x.IsActive).IsUnique().HasFilter("\"IsActive\" = TRUE");
        });
    }
}
