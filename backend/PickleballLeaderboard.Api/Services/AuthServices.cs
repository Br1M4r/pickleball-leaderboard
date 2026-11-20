using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using PickleballLeaderboard.Api.Entities;
using PickleballLeaderboard.Api.Infrastructure;

namespace PickleballLeaderboard.Api.Services;

public sealed class JwtOptions
{
    public string Secret { get; set; } = string.Empty;
    public string Issuer { get; set; } = "PickleballLeaderboard";
    public string Audience { get; set; } = "PickleballLeaderboard.Client";
    public int ExpiryMinutes { get; set; } = 480;

    public SymmetricSecurityKey SigningKey => new(Encoding.UTF8.GetBytes(Secret));
}

public interface ITokenService
{
    (string Token, DateTime ExpiresAt) CreateToken(User user, int? playerId);
}

public sealed class TokenService(JwtOptions options) : ITokenService
{
    public (string Token, DateTime ExpiresAt) CreateToken(User user, int? playerId)
    {
        var expires = DateTime.UtcNow.AddMinutes(options.ExpiryMinutes);

        var claims = new List<Claim>
        {
            new("sub", user.Id.ToString()),
            new("email", user.Email),
            new("role", user.Role.ToString()),
            new("jti", Guid.NewGuid().ToString("N")),
        };
        if (playerId.HasValue)
            claims.Add(new Claim(ClaimsPrincipalExtensions.PlayerIdClaim, playerId.Value.ToString()));

        var descriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Issuer = options.Issuer,
            Audience = options.Audience,
            Expires = expires,
            NotBefore = DateTime.UtcNow,
            SigningCredentials = new SigningCredentials(options.SigningKey, SecurityAlgorithms.HmacSha256)
        };

        var token = new JsonWebTokenHandler().CreateToken(descriptor);
        return (token, expires);
    }
}

/// <summary>PBKDF2 (HMAC-SHA512, 100k iterations, per-user salt) via ASP.NET Core Identity's hasher.</summary>
public interface IPasswordService
{
    string Hash(User user, string password);
    bool Verify(User user, string password, out bool needsRehash);
}

public sealed class PasswordService : IPasswordService
{
    private readonly PasswordHasher<User> _hasher = new();

    public string Hash(User user, string password) => _hasher.HashPassword(user, password);

    public bool Verify(User user, string password, out bool needsRehash)
    {
        var result = _hasher.VerifyHashedPassword(user, user.PasswordHash, password);
        needsRehash = result == PasswordVerificationResult.SuccessRehashNeeded;
        return result != PasswordVerificationResult.Failed;
    }
}
