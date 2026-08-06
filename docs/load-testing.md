# Load Testing

This repo includes a k6 script for booking traffic generation.

## Example

```bash
k6 run -e API_BASE_URL=http://localhost:8000 -e USERS=1000 loadtest/bookings.js
```

## What it measures

- Booking request latency
- Success rate
- Duplicate attempt rate
- Basic queue pressure under load
