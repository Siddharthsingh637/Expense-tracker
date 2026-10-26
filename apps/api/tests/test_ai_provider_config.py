import anthropic

from expense_tracker_api.ai import providers


def test_muse_provider_uses_meta_messages_api_with_bearer_auth(monkeypatch) -> None:
    captured = {}

    class FakeAnthropic:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(anthropic, "Anthropic", FakeAnthropic)
    monkeypatch.setattr(providers, "MODEL_API_KEY", "test-model-api-key")
    monkeypatch.setattr(providers, "MODEL_API_BASE_URL", "https://api.meta.ai")

    provider = providers.MuseProvider()

    assert provider.name == "muse"
    assert captured["auth_token"] == "test-model-api-key"
    assert captured["base_url"] == "https://api.meta.ai"


def test_missing_muse_key_keeps_mock_fallback(monkeypatch) -> None:
    monkeypatch.setattr(providers, "AI_PROVIDER", "muse")
    monkeypatch.setattr(providers, "MODEL_API_KEY", "")

    assert isinstance(providers.get_provider(), providers.MockProvider)
