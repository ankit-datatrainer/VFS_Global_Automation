def notify(root, message):
    """Local-only notification: dashboard, attention request and system bell."""
    root.title("Action required — Bulgaria Type D")
    root.bell()
    root.lift()
    root.attributes("-topmost", True)
    root.after(1500, lambda: root.attributes("-topmost", False))
