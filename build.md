You are a senior Staff Software Engineer and Distributed Systems Architect.

Build a production-quality distributed ticket booking platform inspired by IRCTC, Ticketmaster, and BookMyShow. The primary design goal is to prevent double booking while supporting an architecture capable of scaling to millions of concurrent booking requests.

This is an educational project that demonstrates real-world distributed system design. Focus on correctness, modularity, observability, and scalability rather than shortcuts.

========================
PRIMARY REQUIREMENTS
========================

Build the system incrementally with clean architecture and complete documentation.

Core objectives:
- User authentication using JWT
- Event/train management
- Seat inventory management
- Real-time seat availability
- Booking workflow
- Payment simulation
- Booking confirmation
- Booking cancellation
- Automatic seat release after timeout
- Zero double bookings
- Idempotent booking requests

========================
ARCHITECTURE
========================

Use microservice-inspired modules:

- API Gateway
- Authentication Service
- Event Service
- Seat Inventory Service
- Booking Service
- Payment Service
- Notification Service
- Background Worker Service

Infrastructure:
- PostgreSQL
- Redis
- Kafka (or RabbitMQ initially)
- WebSockets
- Docker Compose

========================
BOOKING FLOW
========================

User selects seats.

↓

Booking request enters queue.

↓

Worker consumes request.

↓

Acquire Redis distributed lock.

↓

Begin database transaction.

↓

Verify seat availability.

↓

Reserve seat.

↓

Process payment.

↓

Confirm booking.

↓

Release lock.

If payment fails:
- Roll back transaction
- Release seat
- Notify user

========================
CONCURRENCY
========================

Implement:
- Redis SET NX EX seat locks
- Database transactions
- Optimistic and pessimistic locking examples
- Unique constraints
- Idempotency keys
- Retry mechanisms
- Dead-letter queue support

========================
REAL-TIME FEATURES
========================

WebSockets should broadcast:
- Seat booked
- Seat released
- Queue position
- Booking confirmation
- Booking cancellation

========================
ADMIN DASHBOARD
========================

Display:
- Active users
- Queue length
- Worker status
- Booking throughput
- Requests per second
- Failed bookings
- Duplicate booking attempts
- Seat occupancy
- Redis health
- Database health

========================
MONITORING
========================

Integrate:
- Prometheus metrics
- Grafana dashboards
- Structured logging
- Health endpoints
- Distributed tracing (optional)

========================
LOAD TESTING
========================

Provide k6 or Locust scripts that simulate:
- 1,000 users
- 10,000 users
- 100,000 users

Design the architecture so it could be horizontally scaled to support much larger loads.

========================
DOCUMENTATION
========================

Produce:
- Complete README
- Architecture diagrams
- Database schema
- API documentation
- Sequence diagrams
- Deployment guide
- Docker Compose setup
- Scaling strategy
- Failure recovery strategy

========================
DEVELOPMENT STRATEGY
========================

Do not generate everything at once.

Build in phases:

Phase 1:
Project setup and architecture

Phase 2:
Authentication

Phase 3:
Event and seat management

Phase 4:
Booking engine

Phase 5:
Redis locking

Phase 6:
Queue processing

Phase 7:
Payment simulation

Phase 8:
Notifications

Phase 9:
Monitoring and metrics

Phase 10:
Load testing

At the end of every phase:
- Explain design decisions.
- Ensure the project runs successfully.
- Write tests.
- Keep code production-ready.