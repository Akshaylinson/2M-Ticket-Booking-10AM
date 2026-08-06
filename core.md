Design and build a distributed ticket booking system that prevents double booking and is architected to support traffic spikes of up to 2 million concurrent booking requests for a limited inventory of seats.

The emphasis is on architecture, correctness, and scalability, not actually generating 2 million users.

What you'll learn

This single project covers almost every major backend concept.

Distributed System Design
Microservices
API Gateway
Authentication
JWT
Load Balancing
Redis
Kafka/RabbitMQ
PostgreSQL
Database Locking
Optimistic vs Pessimistic Locking
Distributed Locks
Queue Processing
Worker Services
Caching
Rate Limiting
Idempotency
Monitoring
Metrics
Logging
Docker
Kubernetes (optional)
Stress Testing
Horizontal Scaling

This is essentially several backend interview topics combined into one project.

The Platform

Imagine you're building your own version of:

IRCTC
BookMyShow
Ticketmaster

Users can:

Register
Login
Browse events
View seat map
Select seats
Pay
Download tickets

Admins can:

Create events
Create trains
Add coaches
Add seats
Monitor live bookings
Architecture
                Internet
                    │
             Load Balancer
                    │
          API Gateway (FastAPI)
                    │
     ┌──────────────┼──────────────┐
     │              │              │
 Auth Service   Booking API   Event API
     │              │              │
     └──────────────┼──────────────┘
                    │
                Redis Cache
                    │
          Kafka / RabbitMQ Queue
                    │
          Booking Worker Cluster
                    │
        Seat Reservation Service
                    │
              PostgreSQL Database
                    │
          Notification Service
                    │
          Email / SMS / WebSocket
Major Services
User Service

Handles

Signup
Login
JWT
Profiles
Event Service

Stores

Events

Movies

Concerts

Train schedules

Flights

Seat Inventory Service

Maintains

Seat A1

Available

Locked

Booked

Every seat has a state.

Booking Service

Responsible for

Booking requests

Locking seats

Payment initiation

Confirmation

Cancellation

Queue Service

This is the heart of the system.

Instead of

2,000,000 Users

↓

Database

we do

2,000,000 Users

↓

API

↓

Queue

↓

Workers

↓

Database
Worker Service

Processes requests sequentially or in parallel.

Workers

Take booking

↓

Lock seat

↓

Reserve seat

↓

Call payment

↓

Confirm booking
Payment Service

For learning

Fake payment API.

Later

Stripe

Razorpay

UPI

Notification Service

After booking

Send

Email

SMS

Push Notification

Preventing Double Booking

This is the main feature.

Implement multiple layers:

Layer 1

Redis Lock

SET seat:A15 user123 NX EX 120
Layer 2

Database Transaction

BEGIN

UPDATE seats

WHERE booked=false

COMMIT
Layer 3

Unique Constraint

(train_id,
coach,
seat_no,
date)

Only one booking possible.

Layer 4

Idempotency Keys

If user presses

Book

10 times

Only one booking is created.

Database

Tables

Users

Events

Shows

Seats

Bookings

Payments

SeatLocks

Notifications

AuditLogs
Redis

Use for

Seat Locks

Cache

Rate Limiting

Session Store

Leaderboard

Live Availability

Queue

Use Kafka or RabbitMQ.

Topics

booking_requests

payment_events

booking_confirmed

booking_cancelled

notifications
Monitoring Dashboard

Real-time dashboard showing:

Users Online

Requests/sec

Queue Length

Average Response

Booked Seats

Available Seats

Worker Status

Redis Usage

CPU

Memory

Database Connections
Admin Dashboard

Should show

Current Queue

Failed Bookings

Retries

Workers Alive

Events

Seats

Revenue

Booking Heatmap
Stress Testing

This is where the fun begins.

Create a load generator.

100 users

1000 users

10000 users

50000 users

100000 users

Later

Simulate

500,000

1 Million

2 Million

using distributed load testing (e.g., multiple machines or cloud instances). Your local machine won't generate that traffic, but your architecture should support it.

Measure

Response time
Queue size
Database latency
Worker throughput
Failed bookings
Duplicate bookings (should remain 0)
Advanced Features

Once the core works, you can add:

Waiting room before booking opens
Virtual queue with queue positions
Dynamic rate limiting
Auto-scaling workers
Seat hold timeout (2 minutes)
Booking analytics
Fraud detection
Multi-region deployment
Disaster recovery
Event sourcing
CQRS
Read replicas
Database sharding
WebSocket live seat updates
Distributed tracing (OpenTelemetry)
Prometheus + Grafana monitoring
Suggested Tech Stack

Backend

FastAPI
Python 3.12

Database

PostgreSQL

Cache

Redis

Queue

Kafka (or RabbitMQ to start)

ORM

SQLAlchemy

Authentication

JWT

Frontend

React + Vite

Real-time

WebSockets

Containers

Docker & Docker Compose

Monitoring

Prometheus
Grafana

Load Testing

k6 or Locust