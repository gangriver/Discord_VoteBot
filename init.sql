-- Initialize VoteBot database
-- This file is run when the PostgreSQL container starts

-- Ensure the database exists
CREATE DATABASE IF NOT EXISTS votebot;

-- Connect to the database
\c votebot;

-- Create extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- The actual tables will be created by Prisma migrations