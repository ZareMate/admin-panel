#!/usr/bin/env python3
"""Rename head/body username PNGs to UUIDs using the panel's name cache."""
import argparse
import json
import os
from pathlib import Path
import re
import uuid


def main():
    default_cache = Path(__file__).resolve().parents[1] / 'web-server/data/cache'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--names', type=Path, default=default_cache / 'mojang-names.json',
                        help='Path to mojang-names.json')
    parser.add_argument('--skins', type=Path, default=default_cache / 'skins',
                        help='Skin cache directory (includes subdirectories)')
    parser.add_argument('--dry-run', action='store_true', help='Preview without renaming')
    args = parser.parse_args()
    try:
        records = json.loads(args.names.read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        parser.error(f'Cannot read username cache: {error}')
    if not isinstance(records, list):
        parser.error('Expected a list of [uuid, record] entries in username cache')
    if not args.skins.is_dir():
        parser.error(f'Skin directory does not exist: {args.skins}')

    names = {}
    for entry in records:
        try:
            player_id, record = entry
            player_id = str(uuid.UUID(player_id))
            name = record['name']
            if isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_]{3,16}', name):
                names.setdefault(name.lower(), set()).add(player_id)
        except (ValueError, TypeError, KeyError, AttributeError):
            continue

    count = 0
    for source in sorted(args.skins.rglob('*.png')):
        match = re.fullmatch(r'(head|body)-([A-Za-z0-9_]{3,16})\.png', source.name)
        if not match or source.is_symlink() or not source.is_file():
            continue
        candidates = names.get(match[2].lower(), set())
        if len(candidates) != 1:
            print(f'SKIP {source}: {"ambiguous username" if candidates else "no UUID found"}')
            continue
        target = source.with_name(f'{match[1]}-{next(iter(candidates))}.png')
        if target.exists() or target.is_symlink():
            print(f'SKIP {source}: UUID file already exists')
            continue
        if not args.dry_run:
            # Linking first preserves timestamps and refuses to overwrite another file.
            try:
                os.link(source, target)
            except FileExistsError:
                print(f'SKIP {source}: UUID file already exists')
                continue
            source.unlink()
        print(f'{"WOULD RENAME" if args.dry_run else "RENAMED"} {source} -> {target.name}')
        count += 1
    print(f'{count} file(s) {"would be renamed" if args.dry_run else "renamed"}.')


if __name__ == '__main__':
    main()
