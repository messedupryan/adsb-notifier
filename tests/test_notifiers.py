from adsb_notifier.notifiers import send_email


def test_send_email_expands_env_values(monkeypatch):
    sent_messages = []
    login_calls = []

    class FakeSmtp:
        def __init__(self, host, port, timeout):
            assert host == "smtp.gmail.com"
            assert port == 587
            assert timeout == 15

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return None

        def starttls(self):
            return None

        def login(self, username, password):
            login_calls.append((username, password))

        def send_message(self, message):
            sent_messages.append(message)

    monkeypatch.setenv("SMTP_USERNAME", "pilot@example.test")
    monkeypatch.setenv("SMTP_PASSWORD", "app-password")
    monkeypatch.setattr("adsb_notifier.notifiers.smtplib.SMTP", FakeSmtp)

    send_email(
        {
            "smtp_host": "smtp.gmail.com",
            "smtp_port": 587,
            "starttls": True,
            "username": "env:SMTP_USERNAME",
            "password": "env:SMTP_PASSWORD",
            "from": "env:SMTP_USERNAME",
            "to": ["env:SMTP_USERNAME"],
        },
        "ADS-B Notifier test notification",
    )

    assert login_calls == [("pilot@example.test", "app-password")]
    assert sent_messages[0]["From"] == "pilot@example.test"
    assert sent_messages[0]["To"] == "pilot@example.test"
