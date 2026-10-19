from app.config import Settings, settings


def test_feature_flags_cover_every_enable_setting():
    flags = settings.feature_flags()
    assert flags["hybrid_search"] is True
    assert set(flags) == {n.removeprefix("ENABLE_").lower() for n in Settings.model_fields if n.startswith("ENABLE_")}


def test_flags_can_be_turned_off_from_the_environment(monkeypatch):
    monkeypatch.setenv("ENABLE_HYBRID_SEARCH", "false")
    assert Settings().feature_flags()["hybrid_search"] is False


async def test_health_and_features_endpoints(client):
    assert (await client.get("/api/health")).json() == {"status": "ok"}
    response = await client.get("/api/features")
    assert response.status_code == 200
    assert response.json() == settings.feature_flags()
    assert "x-request-id" in response.headers
