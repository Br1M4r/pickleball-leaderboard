# Build:  docker build -t pickleball-api .
# Run:    docker run -p 8080:8080 --env-file PickleballLeaderboard.Api/.env pickleball-api
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY PickleballLeaderboard.Api/PickleballLeaderboard.Api.csproj PickleballLeaderboard.Api/
RUN dotnet restore PickleballLeaderboard.Api/PickleballLeaderboard.Api.csproj
COPY PickleballLeaderboard.Api/ PickleballLeaderboard.Api/
RUN dotnet publish PickleballLeaderboard.Api/PickleballLeaderboard.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS=8080
COPY --from=build /app/publish .
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "PickleballLeaderboard.Api.dll"]
