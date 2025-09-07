#!/usr/bin/env python3
"""
Script to fix frontmatter placement issues in .mdc files within .cursor/rules directory.
Moves misplaced frontmatter from the bottom of files to the top where it belongs.
"""

import os
import re
import shutil
from pathlib import Path

def detect_frontmatter_issues():
    """
    Scan .cursor/rules directory for .mdc files with misplaced frontmatter.
    
    Returns:
        list: Paths to files with frontmatter issues
    """
    problematic_files = []
    
    # Hardcoded path and extension
    rules_directory = Path('.cursor/rules')
    extension = '*.mdc'
    
    if not rules_directory.exists():
        print(f"❌ Directory {rules_directory} does not exist!")
        return problematic_files
    
    # Frontmatter pattern - looks for YAML between --- markers
    frontmatter_pattern = r'---\s*\n(.*?)\n---\s*'
    
    # Pattern to detect loose YAML content that should be frontmatter
    loose_yaml_pattern = r'^(description:|globs:|alwaysApply:).*$'
    
    # Find all .mdc files in the rules directory
    mdc_files = list(rules_directory.glob(extension))
    
    if not mdc_files:
        print(f"ℹ️  No .mdc files found in {rules_directory}")
        return problematic_files
    
    print(f"🔍 Found {len(mdc_files)} .mdc files to check...")
    
    for file_path in mdc_files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Check if proper frontmatter exists
            frontmatter_match = re.search(frontmatter_pattern, content, re.DOTALL)
            
            # Check if loose YAML content exists
            lines = content.split('\n')
            has_loose_yaml = False
            loose_yaml_start = -1
            
            for i, line in enumerate(lines):
                if re.match(loose_yaml_pattern, line.strip()):
                    has_loose_yaml = True
                    if loose_yaml_start == -1:
                        loose_yaml_start = i
                    break
            
            if frontmatter_match:
                # Check if frontmatter is at the beginning
                if frontmatter_match.start() > 10:  # Allow for title and some content
                    problematic_files.append(file_path)
                    print(f"   ⚠️  {file_path.name} - frontmatter misplaced at position {frontmatter_match.start()}")
                else:
                    print(f"   ✅ {file_path.name} - frontmatter correctly placed")
            elif has_loose_yaml:
                # File has loose YAML content that should be wrapped in frontmatter
                problematic_files.append(file_path)
                print(f"   ⚠️  {file_path.name} - loose YAML content at line {loose_yaml_start + 1} (needs frontmatter markers)")
            else:
                print(f"   ℹ️  {file_path.name} - no frontmatter or YAML content found")
                
        except Exception as e:
            print(f"❌ Error reading {file_path}: {e}")
    
    return problematic_files

def fix_frontmatter_placement(file_path):
    """
    Fix frontmatter placement by moving it to the top of the file.
    
    Args:
        file_path: Path to the file to fix
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Create backup first
        backup_path = file_path.with_suffix(file_path.suffix + '.backup')
        shutil.copy2(file_path, backup_path)
        print(f"   📋 Created backup: {backup_path.name}")
        
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Check if it has proper frontmatter
        frontmatter_pattern = r'---\s*\n(.*?)\n---\s*'
        frontmatter_match = re.search(frontmatter_pattern, content, re.DOTALL)
        
        if frontmatter_match:
            # Case 1: Frontmatter exists but is misplaced
            frontmatter = frontmatter_match.group(0)
            
            # Remove frontmatter from current position
            content_without_frontmatter = re.sub(frontmatter_pattern, '', content, flags=re.DOTALL).strip()
            
            # Reconstruct file with frontmatter at top
            fixed_content = f"{frontmatter}\n\n{content_without_frontmatter}\n"
            
        else:
            # Case 2: Loose YAML content that needs to be wrapped
            lines = content.split('\n')
            yaml_lines = []
            content_lines = []
            in_yaml_section = False
            found_trailing_marker = False
            
            for line in lines:
                if re.match(r'^(description:|globs:|alwaysApply:).*$', line.strip()):
                    in_yaml_section = True
                    yaml_lines.append(line)
                elif in_yaml_section and line.strip() == '---':
                    # Found the trailing --- marker, end of YAML section
                    found_trailing_marker = True
                    in_yaml_section = False
                    # Don't add this line to content_lines since we're removing it
                elif in_yaml_section and line.strip() == '':
                    # Empty line after YAML, end of YAML section
                    in_yaml_section = False
                    content_lines.append(line)
                elif in_yaml_section:
                    yaml_lines.append(line)
                else:
                    content_lines.append(line)
            
            if yaml_lines:
                # Create proper frontmatter - only one set of --- markers
                frontmatter = "---\n" + "\n".join(yaml_lines) + "\n---"
                
                # Remove YAML lines from content and clean up any trailing --- markers
                content_without_yaml = "\n".join(content_lines).strip()
                
                # Remove any trailing --- markers that might be left
                content_without_yaml = re.sub(r'\n---\s*$', '', content_without_yaml)
                # Also remove any --- markers that might be in the middle
                content_without_yaml = re.sub(r'\n---\s*\n', '\n\n', content_without_yaml)
                
                fixed_content = f"{frontmatter}\n\n{content_without_yaml}\n"
            else:
                print(f"   ❌ No YAML content found to fix in {file_path.name}")
                return False
        
        # Write fixed content
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(fixed_content)
        
        print(f"   ✅ Fixed frontmatter placement in {file_path.name}")
        return True
        
    except Exception as e:
        print(f"   ❌ Error fixing {file_path.name}: {e}")
        # Restore from backup if available
        if backup_path.exists():
            shutil.copy2(backup_path, file_path)
            print(f"   🔄 Restored {file_path.name} from backup due to error")
        return False

def main():
    """
    Main function to find and fix all frontmatter issues in .cursor/rules directory.
    """
    print("🔍 Frontmatter Fixer for .cursor/rules/*.mdc files")
    print("=" * 50)
    
    print("\n📁 Scanning for frontmatter issues...")
    problematic_files = detect_frontmatter_issues()
    
    if not problematic_files:
        print("\n✅ No frontmatter issues found!")
        return
    
    print(f"\n⚠️  Found {len(problematic_files)} files with frontmatter issues:")
    for file_path in problematic_files:
        print(f"   - {file_path.name}")
    
    print(f"\n🔧 Fixing frontmatter placement...")
    
    successful_fixes = 0
    failed_fixes = 0
    
    for file_path in problematic_files:
        print(f"\n📝 Processing {file_path.name}...")
        if fix_frontmatter_placement(file_path):
            successful_fixes += 1
        else:
            failed_fixes += 1
    
    print(f"\n📊 Fix Summary:")
    print(f"   ✅ Successfully fixed: {successful_fixes}")
    print(f"   ❌ Failed to fix: {failed_fixes}")
    
    if failed_fixes > 0:
        print(f"\n⚠️  Some files could not be fixed. Check the logs above.")
        print(f"   Backup files (.backup extension) were created for safety.")
    
    if successful_fixes > 0:
        print(f"\n💡 Tip: You can review the changes and delete .backup files if satisfied.")

if __name__ == "__main__":
    main()
