from test_inquiries import MANSA_SHOP, SECRET, token

from pasazhgard import console_links


def test_prints_each_shops_console_link(client, monkeypatch, capsys):
    monkeypatch.setenv("CONSOLE_SECRET", SECRET)
    console_links.main()
    lines = capsys.readouterr().out.splitlines()
    assert f"{MANSA_SHOP}\tدیسیلا مانسا\t/console/{MANSA_SHOP}?token={token(MANSA_SHOP)['token']}" in lines
