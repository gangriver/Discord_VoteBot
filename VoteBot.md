# VoteBot 📊

A Discord bot for creating interactive polls with automated voting, scheduling, and statistics.

## Features

- **Slash Commands**: Modern Discord slash command interface
- **Interactive Voting**: Button-based voting with real-time updates
- **Poll Types**: Single or multiple choice polls
- **Anonymous Voting**: Optional anonymous poll mode
- **Scheduled Closing**: Automatic poll expiration
- **Duplicate Prevention**: Built-in vote validation and idempotency
- **Statistics**: Comprehensive poll analytics
- **Persistent Storage**: PostgreSQL database with Prisma ORM
- **Job Queue**: Redis-based job scheduling with BullMQ

## Commands

### `/poll create`
Create a new poll with the following options:
- `title` (required): Poll title (max 256 characters)
- `options` (required): Poll options separated by semicolons (2-10 options)
- `description` (optional): Poll description (max 1024 characters)
- `multiple` (optional): Allow multiple selections (default: false)
- `anonymous` (optional): Anonymous voting (default: false)
- `duration` (optional): Poll duration in minutes (1-10080 minutes)

**Example:**
```
/poll create title:"What's your favorite color?" options:"Red;Blue;Green;Yellow" multiple:false duration:60
```

### `/poll close`
Close an active poll (only poll creator can close):
- `poll_id` (required): The poll ID to close

### `/poll stats`
Get detailed statistics for a poll:
- `poll_id` (required): The poll ID for statistics

## Installation & Setup

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- Discord Bot Token

### Local Development

1. **Clone the repository:**
```bash
git clone <repository-url>
cd VoteBot
```

2. **Install dependencies:**
```bash
npm install
```

3. **Set up environment variables:**
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
DATABASE_URL="postgresql://username:password@localhost:5432/votebot"
REDIS_URL="redis://localhost:6379"
NODE_ENV=development
```

4. **Start development services:**
```bash
# Start PostgreSQL and Redis
docker-compose -f docker-compose.dev.yml up -d

# Or use your local installations
```

5. **Set up the database:**
```bash
# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate

# (Optional) Open Prisma Studio
npm run db:studio
```

6. **Deploy Discord commands:**
```bash
npx tsx src/scripts/deployCommands.ts
```

7. **Start the bot:**
```bash
# Development mode with hot reload
npm run dev

# Or start worker separately
npm run worker
```

### Docker Deployment

1. **Create production environment file:**
```bash
cp .env.example .env
```

2. **Configure production variables:**
```env
DISCORD_TOKEN=your_production_bot_token
DISCORD_CLIENT_ID=your_production_client_id
POSTGRES_PASSWORD=secure_postgres_password
REDIS_PASSWORD=secure_redis_password
```

3. **Deploy with Docker Compose:**
```bash
# Production deployment
docker-compose up -d

# Or with custom env file
docker-compose --env-file .env.prod up -d
```

4. **Run database migrations:**
```bash
docker-compose exec bot npx prisma migrate deploy
```

### Cloud Deployment

#### Railway/Render/Fly.io

1. **Deploy services separately:**
   - **Database**: PostgreSQL service
   - **Redis**: Redis service  
   - **Bot**: Main application
   - **Worker**: Background job processor

2. **Environment variables:**
```env
NODE_ENV=production
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DATABASE_URL=your_postgresql_connection_string
REDIS_URL=your_redis_connection_string
```

3. **Build commands:**
```bash
npm install && npm run build
```

4. **Start commands:**
   - **Bot**: `npm start`
   - **Worker**: `npm run worker`

## Architecture

### Core Components

- **Bot Process** (`src/bot.ts`): Main Discord bot handling commands and interactions
- **Worker Process** (`src/worker.ts`): Background job processor for scheduled tasks
- **Database Layer** (`src/database/`): Prisma ORM with PostgreSQL
- **Job Queue** (`src/jobs/`): BullMQ with Redis for scheduled poll closing
- **Services** (`src/services/`): Business logic and vote processing
- **Commands** (`src/commands/`): Discord slash command handlers

### Data Models

#### Poll
- Unique ID, title, description
- Guild/channel/creator information
- Multiple/anonymous voting settings
- Status (OPEN/CLOSED) and expiration

#### PollOption
- Poll option text and emoji
- Position ordering
- Linked to parent poll

#### Vote
- User/poll/option relationship
- Unique constraint prevents duplicates
- Cascading deletes with polls

### Security Features

- **Duplicate Prevention**: Database constraints prevent double voting
- **Input Validation**: Comprehensive validation on all inputs
- **Rate Limiting**: Built into Discord's interaction system
- **Permission Checks**: Creator-only poll management
- **SQL Injection Protection**: Prisma ORM prevents SQL injection

## Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run tests in watch mode
npm test -- --watch
```

## Monitoring & Logs

### Application Logs
- Structured logging with timestamps
- Error tracking and debugging information
- Job processing status and metrics

### Health Checks
- Database connection monitoring
- Redis connection status
- Discord API connectivity

### Metrics
- Poll creation/completion rates
- Vote processing times
- Error rates and types

## Troubleshooting

### Common Issues

**Bot not responding to commands:**
1. Check bot permissions in Discord server
2. Verify slash commands are deployed: `npx tsx src/scripts/deployCommands.ts`
3. Check console for connection errors

**Database connection errors:**
1. Verify PostgreSQL is running and accessible
2. Check DATABASE_URL format and credentials
3. Run migrations: `npm run db:migrate`

**Job queue not processing:**
1. Verify Redis is running and accessible
2. Check REDIS_URL configuration
3. Ensure worker process is running

**Vote duplicates:**
1. Check database constraints are properly set
2. Verify unique index on (userId, pollId, optionId)
3. Review error logs for constraint violations

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Write tests for new functionality
4. Ensure all tests pass: `npm test`
5. Submit a pull request

## License

This project is licensed under the ISC License - see the package.json file for details.

## Support

For issues and feature requests, please create an issue on the repository.