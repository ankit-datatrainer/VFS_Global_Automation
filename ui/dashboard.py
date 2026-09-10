import tkinter as tk
from tkinter import ttk
from notifications.desktop import notify


class Cancelled(RuntimeError):
    pass


class Dashboard:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Bulgaria Type D — New Delhi")
        self.root.geometry("760x620")
        self.root.minsize(650, 530)
        self.cancelled = False
        self.answer = None
        self.status = tk.StringVar(value="Ready")
        self.message = tk.StringVar(value="Load a validated applicant to begin.")
        self.otp = tk.StringVar()
        self.open_browser = lambda: None
        self.applicant = tk.StringVar(value="No applicant loaded")
        frame = ttk.Frame(self.root, padding=24)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text="BULGARIA · TYPE D · NEW DELHI", font=("Segoe UI", 19, "bold")).pack(anchor="w")
        ttk.Label(frame, textvariable=self.applicant).pack(anchor="w", pady=(8, 0))
        ttk.Label(frame, textvariable=self.status, font=("Segoe UI", 14)).pack(anchor="w", pady=(20, 10))
        ttk.Label(frame, textvariable=self.message, wraplength=685, justify="left").pack(anchor="w")
        self.details = tk.Text(frame, height=15, wrap="word", font=("Consolas", 11))
        self.details.pack(fill="both", expand=True, pady=14)
        self.otp_frame = ttk.Frame(frame)
        ttk.Label(self.otp_frame, text="OTP (optional; you can enter it in the browser):").pack(side="left")
        ttk.Entry(self.otp_frame, textvariable=self.otp, show="*", width=15).pack(side="left")
        self.buttons = ttk.Frame(frame)
        self.buttons.pack(fill="x", pady=12)
        ttk.Button(frame, text="Open browser", command=lambda: self.open_browser()).pack(side="left")
        ttk.Button(frame, text="Stop session", command=self.cancel).pack(side="right")
        self.root.protocol("WM_DELETE_WINDOW", self.cancel)

    def cancel(self):
        self.cancelled = True

    def update(self, state=None, message=None, details=None):
        if state is not None:
            self.status.set(str(state).upper())
        if message is not None:
            self.message.set(message)
        if details is not None:
            self.details.configure(state="normal")
            self.details.delete("1.0", "end")
            self.details.insert("1.0", details)
            self.details.configure(state="disabled")
        self.root.update()
        if self.cancelled:
            raise Cancelled("Session stopped by user")

    def choose(self, state, message, details, options, tick, otp=False):
        self.answer = None
        self.otp.set("")
        if otp:
            self.otp_frame.pack(before=self.buttons, fill="x")
        for button in self.buttons.winfo_children():
            button.destroy()
        for label, value in options:
            ttk.Button(self.buttons, text=label, command=lambda v=value: setattr(self, "answer", v)).pack(side="left", padx=(0, 10))
        self.update(state, message, details)
        notify(self.root, message)
        try:
            while self.answer is None:
                self.update()
                tick()
            return self.answer, self.otp.get()
        finally:
            self.otp.set("")
            self.otp_frame.pack_forget()
            for button in self.buttons.winfo_children():
                button.destroy()

    def close(self):
        self.root.destroy()
