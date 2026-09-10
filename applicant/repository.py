import json
from pathlib import Path
from applicant.model import Applicant


def import_json(path: Path, database):
    applicant = Applicant.model_validate(json.loads(path.read_text(encoding="utf-8-sig")))
    database.save_applicant(applicant)
    return applicant
