#!/usr/bin/env python3
# wsl
import sqlite3
import json
from pathlib import Path
from datetime import datetime

# path to WorkspaceStorage on Windows or any paths with folders and state.vscdb inside 
ENTRY_PATH="/Users/xuezi/Library/Application Support/Cursor/User/workspaceStorage"

def extract_conversations(cursor, table_name):
    """
    Try to extract conversation data from the specified table.
    Looks for dicts containing 'conversation' fields.
    """
    print(f"  Searching for conversations in table '{table_name}'...")
    conversations = []
    try:
        cursor.execute(f"SELECT key, value FROM {table_name} LIMIT 1000;")
        rows = cursor.fetchall()
        for key, value in rows:
            try:
                # Decode value if it's a BLOB
                if isinstance(value, bytes):
                    value = value.decode('utf-8')

                # Attempt to parse JSON
                parsed = json.loads(value) if value else None

                # Check for conversation-like data
                if isinstance(parsed, dict) and 'conversation' in parsed:
                    conversations.append({'key': key, 'conversation': parsed['conversation']})
            except:
                # Ignore malformed rows
                pass
    except Exception as e:
        print(f"  Error extracting conversations from '{table_name}': {e}")
    return conversations

def extract_prompts(cursor, table_name):
    """
    Try to extract prompts using the 'textDescription' field or related data from the specified table.
    """
    print(f"  Searching for prompts in table '{table_name}'...")
    prompts = []
    try:
        cursor.execute(f"SELECT key, value FROM {table_name} LIMIT 1000;")
        rows = cursor.fetchall()
        for key, value in rows:
            try:
                # Decode value if it's a BLOB
                if isinstance(value, bytes):
                    value = value.decode('utf-8')

                # Attempt to parse JSON
                parsed = json.loads(value) if value else None

                # Look for prompts in known fields
                if isinstance(parsed, list):
                    for item in parsed:
                        if isinstance(item, dict) and 'textDescription' in item:
                            prompts.append(item['textDescription'])
                elif isinstance(parsed, dict) and 'textDescription' in parsed:
                    prompts.append(parsed['textDescription'])
            except:
                # Ignore malformed rows
                pass
    except Exception as e:
        print(f"  Error extracting prompts from '{table_name}': {e}")
    return prompts

def scan_database(db_path):
    """
    Scan a single SQLite database for conversations and prompts.
    """
    print(f"\nScanning database: {db_path}")
    conversations = []
    prompts = []

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # List all tables in the database
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = cursor.fetchall()

        for table_name, in tables:
            # Attempt to extract conversations
            conversations.extend(extract_conversations(cursor, table_name))
            # Attempt to extract prompts
            prompts.extend(extract_prompts(cursor, table_name))

        conn.close()
    except Exception as e:
        print(f"  Error scanning database {db_path}: {e}")

    return conversations, prompts

def save_to_markdown(output_file, conversations, prompts):
    """
    Save conversations and prompts to a Markdown file.
    """
    with open(output_file, 'a', encoding='utf-8') as f:
        if conversations:
            f.write("# Conversations\n")
            for conv in conversations:
                f.write(f"## Key: {conv['key']}\n")
                for message in conv['conversation']:
                    sender = "User" if message.get('type') == 1 else "Assistant"
                    text = message.get('text', '').strip()
                    f.write(f"**{sender}**: {text}\n")
                f.write("\n---\n")
        else:
            f.write("# No conversations found.\n")

        if prompts:
            f.write("\n# Prompts\n")
            for i, prompt in enumerate(prompts, 1):
                f.write(f"{i}. {prompt.strip()}\n")

def scan_directory(base_path):
    """
    Scan all SQLite databases in the directory and subdirectories for conversation and prompt data.
    """
    base_path = Path(base_path)
    print(f"Scanning directory: {base_path}")

    if not base_path.exists():
        print(f"Directory does not exist: {base_path}")
        return

    # Prepare an output Markdown file
    output_dir = Path("output")
    output_dir.mkdir(exist_ok=True)
    output_file = output_dir / f"conversations_and_prompts_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"

    db_files = list(base_path.rglob("state.vscdb")) + list(base_path.rglob("state.vscdb.backup"))
    if not db_files:
        print("No database files found.")
        return

    print(f"Found {len(db_files)} database files.")
    for db_file in db_files:
        conversations, prompts = scan_database(db_file)
        save_to_markdown(output_file, conversations, prompts)

    print(f"\nData extraction completed! Results saved to {output_file}")

def main():
    """
    Main function to scan a directory and extract conversations and prompts.
    """
    # Update this path to your workspaceStorage directory
    base_path = Path(ENTRY_PATH)
    scan_directory(base_path)

if __name__ == "__main__":
    main()