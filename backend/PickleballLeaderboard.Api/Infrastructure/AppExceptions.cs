namespace PickleballLeaderboard.Api.Infrastructure;

/// <summary>Base type for expected errors that map to a specific HTTP status.</summary>
public abstract class AppException(string message, int statusCode) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

public sealed class NotFoundException(string message) : AppException(message, StatusCodes.Status404NotFound);

public sealed class BadRequestException(string message) : AppException(message, StatusCodes.Status400BadRequest);

public sealed class ConflictException(string message) : AppException(message, StatusCodes.Status409Conflict);

public sealed class ForbiddenException(string message = "You are not allowed to perform this action.")
    : AppException(message, StatusCodes.Status403Forbidden);

public sealed class UnauthorizedException(string message) : AppException(message, StatusCodes.Status401Unauthorized);
