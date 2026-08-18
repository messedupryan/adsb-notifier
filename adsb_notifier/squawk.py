def normalize_squawk_code(value: object) -> str | None:
    if value is None:
        return None
    code = str(value).strip()
    if not code:
        return None
    if code.isdigit() and len(code) < 4:
        code = code.zfill(4)
    if len(code) == 4 and all(char in "01234567" for char in code):
        return code
    return None


def require_squawk_code(value: object) -> str:
    code = normalize_squawk_code(value)
    if code is None:
        raise ValueError(f"invalid squawk code: {value}")
    return code
