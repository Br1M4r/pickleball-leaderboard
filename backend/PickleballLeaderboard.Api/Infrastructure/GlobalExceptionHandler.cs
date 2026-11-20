using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace PickleballLeaderboard.Api.Infrastructure;

/// <summary>Converts exceptions into RFC 7807 problem responses without leaking internals.</summary>
public sealed class GlobalExceptionHandler(ILogger<GlobalExceptionHandler> logger, IHostEnvironment env)
    : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        int status;
        string title;
        string detail;

        switch (exception)
        {
            case AppException app:
                status = app.StatusCode;
                title = ReasonFor(status);
                detail = app.Message;
                break;
            case DbUpdateConcurrencyException:
                status = StatusCodes.Status409Conflict;
                title = "Conflict";
                detail = "The record was changed by someone else. Reload and try again.";
                break;
            case DbUpdateException:
                logger.LogWarning(exception, "Database update failed");
                status = StatusCodes.Status409Conflict;
                title = "Conflict";
                detail = "The change conflicts with existing data (duplicate or invalid reference).";
                break;
            case OperationCanceledException:
                status = 499;
                title = "Client Closed Request";
                detail = "The request was cancelled.";
                break;
            default:
                logger.LogError(exception, "Unhandled exception");
                status = StatusCodes.Status500InternalServerError;
                title = "Server Error";
                detail = env.IsDevelopment() ? exception.Message : "An unexpected error occurred.";
                break;
        }

        var problem = new ProblemDetails
        {
            Status = status,
            Title = title,
            Detail = detail,
            Instance = context.Request.Path
        };

        context.Response.StatusCode = status;
        await context.Response.WriteAsJsonAsync(problem, ct);
        return true;
    }

    private static string ReasonFor(int status) => status switch
    {
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        _ => "Error"
    };
}
