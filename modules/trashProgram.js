// modules/trashProgram.js

import { getTrashFileNames } from './fileState.js';
import { showMessageBox } from './messageBox.js';

export function initTrashProgram({
  buttonId = 'trashProgramBtn'
} = {}) {
  const btn = document.getElementById(buttonId);
  if (!btn) {
    console.warn('[trashProgram] Button not found.');
    return;
  }

  function downloadProgram() {
    const names = getTrashFileNames();
    if (names.length === 0) return;

    const lines = [];
    lines.push('@echo off');
    lines.push('setlocal EnableDelayedExpansion');
    lines.push(`set COUNT=${names.length}`);

    // 🔍 Check if the first file exists
    lines.push(`if not exist "${names[0]}" (`);
    lines.push('  powershell -NoProfile -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::MsgBox((\\"Cannot find the target .wav files.`nPlease place this batch file in the folder containing the .wav files and try again.\\"),\\"OKOnly,Critical\\",\\"File Not Found\\")"');
    lines.push('  exit /b');
    lines.push(')');

    // 📋 List all filenames
    lines.push('echo Listing !COUNT! .wav file(s) to be deleted:');
    names.forEach(name => {
      lines.push(`echo ${name}`);
    });
    lines.push('echo.');

    // 🪟 Confirmation dialog
    lines.push('powershell -NoProfile -Command "Add-Type -AssemblyName Microsoft.VisualBasic; $res=[Microsoft.VisualBasic.Interaction]::MsgBox((\\"This will delete !COUNT! wav file(s). Continue?\\"),\\"OkCancel,Exclamation\\",\\"Confirm Delete\\"); if ($res -ne \\"Ok\\") { exit 0 }"');

    // 🗑️ Deletion loop
    lines.push('set DELETED=0');
    lines.push('for %%F in (');
    names.forEach(name => {
      lines.push(`"${name}"`);
    });
    lines.push(') do (');
    lines.push('  if exist "%%F" (');
    lines.push('    del "%%F"');
    lines.push('    if not errorlevel 1 set /a DELETED+=1');
    lines.push('  )');
    lines.push(')');

    // ✅ Completion dialog
    lines.push('echo.');
    lines.push('powershell -NoProfile -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::MsgBox((\\"Deleted !DELETED! wav file(s).\\"),\\"OKOnly,Information\\",\\"Delete Done\\")"');
    lines.push('endlocal');

    // 🔽 Trigger download
    const blob = new Blob([lines.join('\r\n')], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'delete_trash_files.bat';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  btn.addEventListener('click', () => {
    if (getTrashFileNames().length === 0) return;
    showMessageBox({
      title: 'Auto-trash delete program',
      message: `A batch (.bat) program will be generated to delete the .wav files marked as Trash.\n\nTo proceed:\n1. Move the .bat file to the folder containing those .wav files.\n2. Run the .bat file from that folder to complete the deletion.`,
      confirmText: 'Download',
      cancelText: 'Cancel',
      onConfirm: downloadProgram
    });
  });
}

