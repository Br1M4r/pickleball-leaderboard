using System.Data.Common;
using System.Security.Claims;

namespace PickleballLeaderboard.Api.Infrastructure;

public static class ClaimsPrincipalExtensions
{
    public const string PlayerIdClaim = "player_id";

    public static int GetUserId(this ClaimsPrincipal user)
    {
        var raw = user.FindFirstValue("sub");
        return int.TryParse(raw, out var id) ? id : throw new UnauthorizedException("Invalid token.");
    }

    public static int? GetPlayerId(this ClaimsPrincipal user)
    {
        var raw = user.FindFirstValue(PlayerIdClaim);
        return int.TryParse(raw, out var id) ? id : null;
    }

    public static bool IsAdmin(this ClaimsPrincipal user) => user.IsInRole("Admin");
}

public static class DateTimeExtensions
{
    /// <summary>PostgreSQL timestamptz requires UTC. Unspecified values are treated as UTC.</summary>
    public static DateTime ToUtc(this DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
    };
}

/// <summary>Minimal .env loader for local development (no external package).</summary>
public static class DotEnv
{
    public static void Load(string path)
    {
        if (!File.Exists(path)) return;

        foreach (var rawLine in File.ReadAllLines(path))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;

            var idx = line.IndexOf('=');
            if (idx <= 0) continue;

            var key = line[..idx].Trim();
            var value = line[(idx + 1)..].Trim();
            if (value.Length >= 2 &&
                ((value.StartsWith('"') && value.EndsWith('"')) || (value.StartsWith('\'') && value.EndsWith('\''))))
            {
                value = value[1..^1];
            }

            // Real environment variables always win over the file.
            if (Environment.GetEnvironmentVariable(key) is null)
                Environment.SetEnvironmentVariable(key, value);
        }
    }
}

public static class ConnectionStringResolver
{
    /// <summary>
    /// Accepts either an Npgsql key/value connection string or a Neon-style URL
    /// (postgresql://user:pass@host/db?sslmode=require) and returns an Npgsql string.
    /// </summary>
    public static string Resolve(IConfiguration config)
    {
        var raw = config.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(raw)) raw = config["DATABASE_URL"];

        if (string.IsNullOrWhiteSpace(raw))
            throw new InvalidOperationException(
                "Database connection is not configured. Set ConnectionStrings__DefaultConnection or DATABASE_URL.");

        raw = raw.Trim();
        if (!raw.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) &&
            !raw.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        {
            return raw;
        }

        var uri = new Uri(raw);
        var userInfo = uri.UserInfo.Split(':', 2);
        var query = System.Web.HttpUtility.ParseQueryString(uri.Query);

        var builder = new DbConnectionStringBuilder
        {
            ["Host"] = uri.Host,
            ["Port"] = uri.Port > 0 ? uri.Port : 5432,
            ["Database"] = uri.AbsolutePath.TrimStart('/'),
            ["Username"] = Uri.UnescapeDataString(userInfo[0]),
            ["Password"] = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : string.Empty,
            ["SSL Mode"] = MapSslMode(query["sslmode"]),
        };
        return builder.ConnectionString;
    }

    private static string MapSslMode(string? mode) => mode?.ToLowerInvariant() switch
    {
        "disable" => "Disable",
        "allow" => "Allow",
        "prefer" => "Prefer",
        "verify-ca" => "VerifyCA",
        "verify-full" => "VerifyFull",
        _ => "Require" // Neon requires TLS
    };
}
