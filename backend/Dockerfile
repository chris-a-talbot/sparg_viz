# Start from official Miniconda image
FROM continuumio/miniconda3:latest

# Set working directory
WORKDIR /app

# Install libmamba solver for faster env creation
RUN conda install -n base conda-libmamba-solver \
    && conda config --set solver libmamba \
    && conda config --remove-key channels \
    && conda config --add channels defaults \
    && conda config --add channels bioconda \
    && conda config --add channels conda-forge \
    && conda config --set channel_priority strict

# Copy env and pip requirements first (Docker layer caching)
COPY environment.yml .
COPY requirements-web.txt .

# Create the environment
RUN conda env create -f environment.yml \
    && conda clean -afy

# Activate environment by default
SHELL ["conda", "run", "-n", "sparg_viz", "/bin/bash", "-c"]

# Copy application code
COPY . .

# Expose app port
EXPOSE 8000

# Default command
CMD ["conda", "run", "--no-capture-output", "-n", "sparg_viz", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
