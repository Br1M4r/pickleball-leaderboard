using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using PickleballLeaderboard.Api.Data;
using PickleballLeaderboard.Api.Dtos;
using PickleballLeaderboard.Api.Entities;
using PickleballLeaderboard.Api.Infrastructure;
using PickleballLeaderboard.Api.Services;

namespace PickleballLeaderboard.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(AppDbContext db, IPasswordService passwords, ITokenService tokens) : ControllerBase
{
    /// <summary>Self-registration creates a Player account and its player profile.</summary>
    [HttpPost("register")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest req, CancellationToken ct)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.Email == email, ct))
            throw new ConflictException("An account with this email already exists.");

        var user = new User { Email = email, Role = UserRole.Player, IsActive = true };
        user.PasswordHash = passwords.Hash(user, req.Password);

        var player = new Player
        {
            User = user,
            FullName = req.FullName.Trim(),
            Gender = req.Gender!.Value,
            Age = req.Age!.Value,
            SkillLevel = req.SkillLevel!.Value,
            PlayingCategory = req.PlayingCategory!.Value,
            DateRegistered = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            IsActive = true
        };

        db.Players.Add(player);
        user.LastLoginAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var (token, expires) = tokens.CreateToken(user, player.Id);
        return Ok(new AuthResponse(token, expires, user.ToDto()));
    }

    [HttpPost("login")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req, CancellationToken ct)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        var user = await db.Users.Include(u => u.Player).FirstOrDefaultAsync(u => u.Email == email, ct);

        // Same message for unknown email and wrong password to avoid account enumeration.
        if (user is null || !passwords.Verify(user, req.Password, out var needsRehash))
            throw new UnauthorizedException("Invalid email or password.");

        if (!user.IsActive)
            throw new ForbiddenException("This account has been deactivated. Contact an administrator.");

        if (needsRehash) user.PasswordHash = passwords.Hash(user, req.Password);
        user.LastLoginAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var (token, expires) = tokens.CreateToken(user, user.Player?.Id);
        return Ok(new AuthResponse(token, expires, user.ToDto()));
    }

    [Authorize]
    [HttpGet("me")]
    public async Task<ActionResult<UserDto>> Me(CancellationToken ct)
    {
        var id = User.GetUserId();
        var user = await db.Users.AsNoTracking().Include(u => u.Player).FirstOrDefaultAsync(u => u.Id == id, ct)
                   ?? throw new NotFoundException("User not found.");
        return Ok(user.ToDto());
    }

    [Authorize]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest req, CancellationToken ct)
    {
        var id = User.GetUserId();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct)
                   ?? throw new NotFoundException("User not found.");

        if (!passwords.Verify(user, req.CurrentPassword, out _))
            throw new BadRequestException("Current password is incorrect.");

        user.PasswordHash = passwords.Hash(user, req.NewPassword);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
}
