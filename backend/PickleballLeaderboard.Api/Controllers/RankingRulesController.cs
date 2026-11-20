using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PickleballLeaderboard.Api.Data;
using PickleballLeaderboard.Api.Dtos;
using PickleballLeaderboard.Api.Infrastructure;
using PickleballLeaderboard.Api.Services;

namespace PickleballLeaderboard.Api.Controllers;

[ApiController]
[Route("api/ranking-rules")]
public class RankingRulesController(AppDbContext db, ILeaderboardService leaderboard) : ControllerBase
{
    /// <summary>Public so players can see how points are earned.</summary>
    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<RankingRuleDto>> Get(CancellationToken ct)
    {
        var rules = await leaderboard.GetActiveRulesAsync(ct);
        return Ok(rules.ToDto());
    }

    /// <summary>Update the active rules and rebuild every ranking with them.</summary>
    [HttpPut]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<RankingRuleDto>> Update(RankingRuleRequest req, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var rules = await leaderboard.GetActiveRulesAsync(ct);
        rules.Name = req.Name.Trim();
        rules.WinPoints = req.WinPoints;
        rules.LossPoints = req.LossPoints;
        rules.MarginBonusThreshold = req.MarginBonusThreshold;
        rules.MarginBonusPoints = req.MarginBonusPoints;
        rules.StreakBonusThreshold = req.StreakBonusThreshold;
        rules.StreakBonusPoints = req.StreakBonusPoints;
        rules.MinMatchesToRank = req.MinMatchesToRank;
        rules.AllowNegativePoints = req.AllowNegativePoints;
        rules.UpdatedAt = DateTime.UtcNow;
        rules.UpdatedByUserId = User.GetUserId();
        await db.SaveChangesAsync(ct);

        await leaderboard.RecalculateAsync(ct);
        await tx.CommitAsync(ct);

        return Ok(rules.ToDto());
    }
}
