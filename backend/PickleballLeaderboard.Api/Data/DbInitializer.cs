using Microsoft.EntityFrameworkCore;
using PickleballLeaderboard.Api.Entities;
using PickleballLeaderboard.Api.Services;

namespace PickleballLeaderboard.Api.Data;

/// <summary>
/// Prepares the database on startup: applies the schema, ensures an active ranking rule set,
/// and creates the first administrator from configuration. No sample/mock data is inserted.
/// </summary>
public static class DbInitializer
{
    public static async Task InitializeAsync(IServiceProvider services, IConfiguration config, ILogger logger)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var passwords = scope.ServiceProvider.GetRequiredService<IPasswordService>();

        // Use EF migrations when they exist; otherwise create the schema directly from the model.
        if (db.Database.GetMigrations().Any())
        {
            logger.LogInformation("Applying EF Core migrations...");
            await db.Database.MigrateAsync();
        }
        else
        {
            logger.LogInformation("No migrations found - ensuring schema exists...");
            await db.Database.EnsureCreatedAsync();
        }

        if (!await db.RankingRules.AnyAsync(r => r.IsActive))
        {
            db.RankingRules.Add(new RankingRule { Name = "Default", IsActive = true });
            await db.SaveChangesAsync();
            logger.LogInformation("Created default ranking rules.");
        }

        if (await db.Users.AnyAsync(u => u.Role == UserRole.Admin))
            return;

        var email = config["Admin:Email"]?.Trim().ToLowerInvariant();
        var password = config["Admin:Password"];
        var fullName = config["Admin:FullName"] ?? "League Administrator";

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password) || password.Length < 8)
        {
            logger.LogWarning(
                "No administrator exists. Set Admin__Email and Admin__Password (min 8 chars) and restart to create one.");
            return;
        }

        var existing = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        if (existing is not null)
        {
            existing.Role = UserRole.Admin;
            existing.IsActive = true;
            await db.SaveChangesAsync();
            logger.LogInformation("Promoted existing user {Email} to Admin.", email);
            return;
        }

        var admin = new User { Email = email, Role = UserRole.Admin, IsActive = true };
        admin.PasswordHash = passwords.Hash(admin, password);
        db.Users.Add(admin);
        await db.SaveChangesAsync();

        logger.LogInformation("Created administrator account {Email} ({Name}).", email, fullName);
    }
}
