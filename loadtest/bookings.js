import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const API_BASE_URL = __ENV.API_BASE_URL || 'http://localhost:8000';
const USERS = Number(__ENV.USERS || '100');
const SEATS = Number(__ENV.SEATS || '1');

export const options = {
  vus: USERS,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

const seats = new SharedArray('seats', () => Array.from({ length: SEATS }, (_, i) => `A${i + 1}`));

export default function () {
  const register = http.post(`${API_BASE_URL}/auth/register`, JSON.stringify({
    email: `user-${__VU}-${__ITER}@example.com`,
    password: 'password123',
    role: 'user',
  }), { headers: { 'Content-Type': 'application/json' } });

  check(register, { 'register status is 200/409': (res) => [200, 409].includes(res.status) });

  const login = http.post(`${API_BASE_URL}/auth/login`, JSON.stringify({
    email: `user-${__VU}-${__ITER}@example.com`,
    password: 'password123',
  }), { headers: { 'Content-Type': 'application/json' } });

  if (login.status !== 200) {
    sleep(1);
    return;
  }

  const token = login.json('access_token');
  const booking = http.post(
    `${API_BASE_URL}/bookings/request`,
    JSON.stringify({
      event_id: 1,
      seat_numbers: [seats[0]],
      idempotency_key: `${__VU}-${__ITER}-${Date.now()}`,
      payment_method: 'demo',
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
  );

  check(booking, {
    'booking request accepted': (res) => res.status === 200,
  });

  sleep(1);
}
