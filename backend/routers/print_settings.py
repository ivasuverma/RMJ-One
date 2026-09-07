"""Print Master — Settings > Masters screen that lets the owner customize
what each printed receipt/challan shows (Repairs, Stock In/Out, Gold Loans):
hide fields, reorder them, set a point size per field (or one overall size),
toggle the shop-name header — without a code change. Registry and
filter/reorder helpers live in print_templates.py (kept import-free of
server.py); this router is just the thin CRUD over that config."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from server import db, now_utc, require_owner, log_audit
from print_templates import PRINT_TEMPLATES, MODULE_LABELS, template_config, MIN_FONT_SIZE, MAX_FONT_SIZE

router = APIRouter()


@router.get('/settings/print-templates')
async def list_print_templates(_: dict = Depends(require_owner)):
    doc = await db.settings.find_one({'id': 'print_templates'}, {'_id': 0})
    return {
        key: {
            'label': meta['label'], 'module': meta['module'], 'module_label': MODULE_LABELS[meta['module']],
            'fields': meta['fields'],
            **{k: (sorted(v) if isinstance(v, set) else v) for k, v in template_config(doc, key).items()},
        }
        for key, meta in PRINT_TEMPLATES.items()
    }


class PrintTemplateIn(BaseModel):
    disabled_fields: list[str] = []
    font_size: int = 10
    field_sizes: dict[str, int] = {}
    field_order: list[str] = []
    title_size: Optional[int] = None
    show_shop_name: bool = True
    field_dividers: bool = False


@router.put('/settings/print-templates/{template_key}')
async def set_print_template(template_key: str, body: PrintTemplateIn, user: dict = Depends(require_owner)):
    meta = PRINT_TEMPLATES.get(template_key)
    if not meta:
        raise HTTPException(status_code=404, detail='Unknown print template')
    if not (MIN_FONT_SIZE <= body.font_size <= MAX_FONT_SIZE):
        raise HTTPException(status_code=400, detail=f'font_size must be between {MIN_FONT_SIZE} and {MAX_FONT_SIZE}')
    if body.title_size is not None and not (MIN_FONT_SIZE <= body.title_size <= MAX_FONT_SIZE):
        raise HTTPException(status_code=400, detail=f'title_size must be between {MIN_FONT_SIZE} and {MAX_FONT_SIZE}')
    valid_keys = {f['key'] for f in meta['fields']}
    for k, v in body.field_sizes.items():
        if k in valid_keys and not (MIN_FONT_SIZE <= v <= MAX_FONT_SIZE):
            raise HTTPException(status_code=400, detail=f'{k}: size must be between {MIN_FONT_SIZE} and {MAX_FONT_SIZE}')
    cfg = {
        'disabled_fields': [k for k in body.disabled_fields if k in valid_keys],
        'font_size': body.font_size,
        'field_sizes': {k: v for k, v in body.field_sizes.items() if k in valid_keys},
        'field_order': [k for k in body.field_order if k in valid_keys],
        'title_size': body.title_size,
        'show_shop_name': body.show_shop_name,
        'field_dividers': body.field_dividers,
    }
    await db.settings.update_one(
        {'id': 'print_templates'},
        {'$set': {f'templates.{template_key}': cfg, 'updated_at': now_utc().isoformat()}},
        upsert=True,
    )
    await log_audit(user, 'settings.print_template.update', 'settings', template_key,
                     f"{meta['label']}: {len(cfg['disabled_fields'])} field(s) hidden, {body.font_size}pt"
                     + ('' if body.show_shop_name else ', shop name hidden'))
    return {'label': meta['label'], 'module': meta['module'], 'module_label': MODULE_LABELS[meta['module']],
            'fields': meta['fields'], **cfg}
