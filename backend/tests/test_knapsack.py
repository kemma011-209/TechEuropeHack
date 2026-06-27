"""Word-level budget knapsack tests."""

from app import demo
from app.graph import knapsack
from app.graph.knapsack import WordToken


def _words(specs: list[tuple[str, str, float]]) -> list[WordToken]:
    """specs: (text, source, value) -> indexed WordTokens."""
    return [
        WordToken(index=i, text=t, source=s, value=v)
        for i, (t, s, v) in enumerate(specs)
    ]


def test_edit_words_survive_before_base():
    # Two base words and one edit word; budget only fits ~2 words.
    words = _words(
        [
            ("alpha", "base", 0.3),
            ("bravo", "edit", 0.85),
            ("charlie", "base", 0.3),
        ]
    )
    # Budget tight enough to force dropping at least one word.
    res = knapsack.solve_words(words, 12)
    kept = set(res.kept_indices)
    assert 1 in kept  # the edit word is protected
    assert res.total_chars <= 12


def test_optimal_packing_prefers_two_small_over_one_big():
    # Equal value per word: the optimal knapsack keeps the two short words
    # rather than the single long one, packing the budget fuller.
    words = _words(
        [
            ("S", "base", 0.3),       # subject (index 0) - always kept
            ("aa", "base", 0.5),      # len 2
            ("bbbbb", "base", 0.5),   # len 5
            ("cc", "base", 0.5),      # len 2
        ]
    )
    res = knapsack.solve_words(words, 7)
    assert set(res.kept_indices) == {0, 1, 3}  # two small beat one big
    assert res.total_chars <= 7


def test_fills_budget_better_than_dropping_extra():
    # A long low-value word vs two short high-value words under a tight budget:
    # the optimiser should keep the high-value pair and use the budget fully.
    words = _words(
        [
            ("Acme", "base", 0.3),         # subject, forced
            ("scalable", "base", 0.2),     # long, low value
            ("auditable", "edit", 0.9),    # valuable
            ("fast", "edit", 0.9),         # valuable
        ]
    )
    res = knapsack.solve_words(words, 20)
    kept = set(res.kept_indices)
    assert 2 in kept and 3 in kept  # both edit words retained
    assert res.total_chars <= 20


def test_assemble_preserves_order():
    words = _words(
        [
            ("Acme", "base", 0.3),
            ("builds", "base", 0.3),
            ("tools", "edit", 0.9),
        ]
    )
    res = knapsack.solve_words(words, 100)
    assert knapsack.assemble_words(words, res) == "Acme builds tools"


def test_infeasible_single_long_word():
    words = _words([("supercalifragilistic", "base", 0.3)])
    res = knapsack.solve_words(words, 5)
    assert res.feasible is False  # cannot fit, but still assembled
    assert res.kept_indices == [0]


def test_demo_154_trims_to_150():
    assert len(demo.DEMO_DRAFT) > 150
    words = [
        WordToken(index=i, text=w, source="base", value=0.3)
        for i, w in enumerate(demo.DEMO_DRAFT.split())
    ]
    res = knapsack.solve_words(words, 150)
    final = knapsack.assemble_words(words, res)
    assert res.feasible is True
    assert len(final) <= 150
