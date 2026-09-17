"""Private PaddleOCR bridge for DearPolicy.

The Node application sends one JSON request over stdin. The result is written
to the requested temporary JSON path so Paddle/PaddleX logging cannot corrupt
the machine-readable response. PDF passwords never appear in process arguments.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Any, Mapping


def _as_dict(result: Any) -> dict[str, Any]:
    if isinstance(result, Mapping):
        return dict(result)
    for attribute in ("json", "to_dict", "dict"):
        value = getattr(result, attribute, None)
        if value is None:
            continue
        try:
            value = value() if callable(value) else value
            if isinstance(value, str):
                value = json.loads(value)
            if isinstance(value, Mapping):
                return dict(value)
        except Exception:
            continue
    return {}


def _blocks(data: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    direct = data.get("parsing_res_list")
    if isinstance(direct, list):
        return [item for item in direct if isinstance(item, Mapping)]
    for key in ("res", "result", "data"):
        nested = data.get(key)
        if isinstance(nested, Mapping):
            found = _blocks(nested)
            if found:
                return found
    return []


def _result_text(result: Any, page_dir: Path) -> str:
    data = _as_dict(result)
    contents = [str(block.get("block_content", "")).strip() for block in _blocks(data)]
    text = "\n\n".join(content for content in contents if content)
    if text:
        return text

    # This fallback protects DearPolicy from minor PaddleX result-schema changes.
    page_dir.mkdir(parents=True, exist_ok=True)
    saver = getattr(result, "save_to_markdown", None)
    if callable(saver):
        saver(save_path=page_dir)
        markdown_files = list(page_dir.rglob("*.md"))
        if markdown_files:
            return max((item.read_text(encoding="utf-8") for item in markdown_files), key=len, default="").strip()
    return ""


def _render_pages(input_path: str, password: str, page_numbers: list[int], dpi: int, target: Path) -> list[tuple[int, str]]:
    import fitz

    document = fitz.open(input_path)
    try:
        if document.needs_pass and not document.authenticate(password):
            raise RuntimeError("The PDF password appears to be incorrect.")
        rendered: list[tuple[int, str]] = []
        scale = dpi / 72.0
        for page_number in page_numbers:
            if page_number < 1 or page_number > document.page_count:
                raise RuntimeError(f"PDF page {page_number} does not exist.")
            page = document.load_page(page_number - 1)
            destination = target / f"page-{page_number:05d}.png"
            page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).save(destination)
            rendered.append((page_number, str(destination)))
        return rendered
    finally:
        document.close()


def main() -> int:
    request = json.load(sys.stdin)
    result_path = Path(request["resultPath"])
    try:
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        from paddleocr import PaddleOCRVL

        page_numbers = sorted({int(value) for value in request.get("pageNumbers", [])})
        if not page_numbers:
            raise RuntimeError("No PDF pages were selected for OCR.")

        with tempfile.TemporaryDirectory(prefix="dearpolicy-paddle-") as working:
            working_path = Path(working)
            rendered = _render_pages(
                str(request["inputPath"]),
                str(request.get("password", "")),
                page_numbers,
                int(request.get("dpi", 200)),
                working_path,
            )
            options: dict[str, Any] = {"pipeline_version": str(request.get("pipelineVersion", "v1.6"))}
            device = str(request.get("device", "auto"))
            if device and device != "auto":
                options["device"] = device
            pipeline = PaddleOCRVL(**options)
            predictions = pipeline.predict([image_path for _, image_path in rendered])
            pages = []
            for index, prediction in enumerate(predictions):
                if index >= len(rendered):
                    break
                page_number = rendered[index][0]
                text = _result_text(prediction, working_path / f"result-{page_number:05d}")
                pages.append({"pageNumber": page_number, "text": text})

        result_path.write_text(json.dumps({"ok": True, "pages": pages}, ensure_ascii=False), encoding="utf-8")
        return 0
    except Exception as error:
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(
            json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False),
            encoding="utf-8",
        )
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
