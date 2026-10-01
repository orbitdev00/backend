from PIL import Image
import win32com.client, os

# Convert webp to ico
img = Image.open(r"C:\Users\Alexander\OneDrive\Pictures\903_total_solar.webp")
img = img.resize((256, 256))
ico_path = r"C:\Users\Alexander\KKBOT\backend\orbit_icon.ico"
img.save(ico_path, format="ICO")

# Create shortcut on desktop
shell = win32com.client.Dispatch("WScript.Shell")
desktop = shell.SpecialFolders("Desktop")
shortcut = shell.CreateShortcut(os.path.join(desktop, "Orbit Terminal.lnk"))
shortcut.TargetPath = r"C:\Users\Alexander\KKBOT\backend\launch_orbit.bat"
shortcut.WorkingDirectory = r"C:\Users\Alexander\KKBOT\backend"
shortcut.IconLocation = ico_path
shortcut.save()

print("Done — drag Orbit Terminal from your desktop to the taskbar.")
