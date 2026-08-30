
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_register_login_me():
    response = client.post("/auth/register", json={"email": "someone@example.com", "password": "password123", "role": "user"})
    assert response.status_code == 200, response.text
    login = client.post("/auth/login", json={"email": "someone@example.com", "password": "password123"})
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    assert me.json()["email"] == "someone@example.com"








