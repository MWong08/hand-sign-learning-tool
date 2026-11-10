"""Download the index files of the Kaggle `asl-signs` competition (not the landmark clips).

train.csv                          one row per clip: path, participant_id, sequence_id, sign
sign_to_prediction_index_map.json  sign name -> class index (250 signs)

The clips (~94k parquet files) are downloaded later, and only for the signs chosen for the
curriculum. See select_vocabulary.py.

Run from model/:  python src/download_metadata.py
"""
from pathlib import Path

from kaggle.api.kaggle_api_extended import KaggleApi

COMPETITION = "asl-signs"
RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
FILES = ["train.csv", "sign_to_prediction_index_map.json"]


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    api = KaggleApi()
    api.authenticate()  # uses cached `kaggle auth login` credentials or ~/.kaggle/access_token

    for name in FILES:
        if (RAW_DIR / name).exists():
            print(f"skip {name} (already downloaded)")
            continue
        print(f"downloading {name} ...")
        api.competition_download_file(COMPETITION, name, path=RAW_DIR, quiet=False)

    # The Kaggle API zips some single-file downloads; unzip if needed.
    for zipped in RAW_DIR.glob("*.zip"):
        import zipfile
        with zipfile.ZipFile(zipped) as z:
            z.extractall(RAW_DIR)
        zipped.unlink()

    print("done:", sorted(p.name for p in RAW_DIR.iterdir()))


if __name__ == "__main__":
    main()
