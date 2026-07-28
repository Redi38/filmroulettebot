"""Shared utilities."""
import html


def esc(text: str) -> str:
    """Escape HTML special characters."""
    return html.escape(str(text))
