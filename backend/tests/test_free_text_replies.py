from test_inquiries import MANSA, MAHIS, inbox, reply, sent

from pasazhgard.agent import chat_model_from_env


def test_free_text_parses_into_the_reply_shape(client, seller_parses):
    _, [mansa] = sent(client, MANSA)
    text = "موجوده، امروز ۳ میلیون و ۴۰۰، تا ۵ عصر نگه می‌دارم، قسطی هم داریم"
    seller_parses(
        {"available": "yes", "latest_price_toman": 3_400_000, "hold_until": "17:00", "installments": True, "notes": "قسطی دارد", "confidence": 0.9}
    )

    after = reply(client, mansa, text=text)

    assert after["status"] == "confirmed"
    assert after["reply"] == {
        "available": "yes",
        "latest_price_toman": 3_400_000,
        "hold_until": "17:00:00",
        "installments": True,
        "notes": "قسطی دارد",
        "confidence": 0.9,
    }
    # the seller's words stay in the timeline as sent
    assert after["events"][-1]["reply"] == {"text": text}
    assert after["events"][-1]["question"] is None


def test_a_parse_keeps_what_earlier_replies_said(client, seller_parses):
    _, [mansa] = sent(client, MANSA)
    reply(client, mansa, latest_price_toman=3_400_000)
    seller_parses({"available": "no", "confidence": 0.95})

    after = reply(client, mansa, text="تمام شد")

    assert after["status"] == "unavailable"
    assert (after["reply"]["latest_price_toman"], after["reply"]["confidence"]) == (3_400_000, 0.95)


def test_an_ambiguous_reply_gets_one_follow_up_then_resolves(client, seller_parses):
    sid, [mahis] = sent(client, MAHIS)
    question = "یعنی الان موجود است؟"
    seller_parses({"available": "unknown", "confidence": 0.3, "follow_up": question}, {"available": "yes", "confidence": 0.9})

    after = reply(client, mahis, text="شاید، باید ببینم")

    assert (after["status"], after["reply"]["available"]) == ("replied", "unknown")
    assert after["events"][-1]["question"] == question
    # the seller sees the question on the Seller Console
    [seen] = [i for i in inbox(client, after["shop_id"])["inquiries"] if i["inquiry_id"] == mahis]
    assert seen["events"][-1]["question"] == question

    assert reply(client, mahis, text="آره هست")["status"] == "confirmed"


def test_a_second_ambiguous_reply_gets_no_second_follow_up(client, seller_parses):
    _, [mahis] = sent(client, MAHIS)
    seller_parses(
        {"available": "unknown", "confidence": 0.3, "follow_up": "یعنی الان موجود است؟"},
        {"available": "unknown", "confidence": 0.3, "follow_up": "بالاخره موجود است؟"},
    )

    reply(client, mahis, text="شاید")
    after = reply(client, mahis, text="نمی‌دانم")

    assert (after["status"], after["reply"]["available"]) == ("replied", "unknown")
    assert [e["question"] for e in after["events"] if e["question"]] == ["یعنی الان موجود است؟"]


def test_without_a_model_free_text_stays_unparsed(client):
    _, [mansa] = sent(client, MANSA)

    after = reply(client, mansa, text="شاید فردا")

    assert (after["status"], after["reply"]["available"], after["reply"]["confidence"]) == ("replied", "unknown", None)
    assert after["events"][-1] == {**after["events"][-1], "reply": {"text": "شاید فردا"}, "question": None}


def test_parsing_uses_the_small_model(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "k")
    monkeypatch.delenv("LLM_SMALL_MODEL", raising=False)

    assert chat_model_from_env(small=True).model_name == "gpt-5.4-mini"
    monkeypatch.setenv("LLM_SMALL_MODEL", "tiny")
    assert chat_model_from_env(small=True).model_name == "tiny"
    monkeypatch.delenv("LLM_API_KEY")
    assert chat_model_from_env(small=True) is None
