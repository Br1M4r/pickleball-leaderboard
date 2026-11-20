using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using PickleballLeaderboard.Api.Data;
using PickleballLeaderboard.Api.Infrastructure;
using PickleballLeaderboard.Api.Services;

// Local development convenience: load backend/.env (real environment variables take precedence).
DotEnv.Load(Path.Combine(Directory.GetCurrentDirectory(), ".env"));

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

// Hosting platforms such as Render/Railway/Heroku supply the port through $PORT.
var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrWhiteSpace(port)) builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

// ---------------------------------------------------------------- configuration
var jwt = config.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
// Accept JWT_SECRET too (the naming used by Vercel / `vercel env pull`).
if (string.IsNullOrWhiteSpace(jwt.Secret)) jwt.Secret = config["JWT_SECRET"] ?? "";
if (string.IsNullOrWhiteSpace(jwt.Secret) || jwt.Secret.Length < 32)
    throw new InvalidOperationException("Jwt__Secret (or JWT_SECRET) must be set to a random string of at least 32 characters.");

var corsOrigins = (config["Cors:AllowedOrigins"] ?? "http://localhost:5173")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

// ---------------------------------------------------------------- services
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(ConnectionStringResolver.Resolve(config)));

builder.Services.AddSingleton(jwt);
builder.Services.AddSingleton<ITokenService, TokenService>();
builder.Services.AddSingleton<IPasswordService, PasswordService>();
builder.Services.AddScoped<ILeaderboardService, LeaderboardService>();

builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = jwt.SigningKey,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
            NameClaimType = "email",
            RoleClaimType = "role"
        };
        o.Events = new JwtBearerEvents
        {
            // Reject tokens of users who were deactivated or whose role changed after the token was issued.
            OnTokenValidated = async ctx =>
            {
                var sub = ctx.Principal?.FindFirst("sub")?.Value;
                var role = ctx.Principal?.FindFirst("role")?.Value;
                if (!int.TryParse(sub, out var userId))
                {
                    ctx.Fail("Invalid subject.");
                    return;
                }

                var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                var user = await db.Users.AsNoTracking()
                    .Where(u => u.Id == userId)
                    .Select(u => new { u.IsActive, u.Role })
                    .FirstOrDefaultAsync();

                if (user is null || !user.IsActive || user.Role.ToString() != role)
                    ctx.Fail("Account is inactive or has changed. Please sign in again.");
            }
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddCors(o => o.AddPolicy("frontend", p => p
    .WithOrigins(corsOrigins)
    .AllowAnyHeader()
    .AllowAnyMethod()));

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});

builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    // Cloud hosts terminate TLS at their proxy; trust the forwarded headers they add.
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

var app = builder.Build();

// ---------------------------------------------------------------- pipeline
app.UseForwardedHeaders();
app.UseExceptionHandler();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi(); // GET /openapi/v1.json
}
else
{
    // HTTPS is terminated by the hosting provider's edge; HSTS tells browsers to always use it.
    app.UseHsts();
}

app.UseCors("frontend");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHealthChecks("/health");
app.MapGet("/", () => Results.Ok(new { name = "Pickleball Leaderboard API", status = "running" }));

await DbInitializer.InitializeAsync(app.Services, config, app.Logger);

app.Run();

public partial class Program;
