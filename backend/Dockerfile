# Multi-stage Dockerfile for spARGviz backend
# Supports both development and production builds

FROM continuumio/miniconda3:latest AS base

# Set working directory
WORKDIR /app

# Install system dependencies and libmamba solver for faster env creation
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && conda install -n base conda-libmamba-solver \
    && conda config --set solver libmamba \
    && conda config --remove-key channels \
    && conda config --add channels defaults \
    && conda config --add channels bioconda \
    && conda config --add channels conda-forge \
    && conda config --set channel_priority strict

# Copy environment files first (Docker layer caching)
COPY environment.yml .
COPY requirements-web.txt .

# Create the conda environment
RUN conda env create -f environment.yml \
    && conda clean -afy

# Activate environment by default
SHELL ["conda", "run", "-n", "sparg_viz", "/bin/bash", "-c"]

# Development stage
FROM base AS development

# Copy application code
COPY . .

# Expose development port
EXPOSE 8000

# Set environment variables for development
ENV ENV=development
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# Start development server with hot reload
CMD ["conda", "run", "--no-capture-output", "-n", "sparg_viz", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# Production stage
FROM base AS production

# Copy application code
COPY . .

# Expose production port
EXPOSE 8000

# Set environment variables for production
ENV ENV=production
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# Create non-root user for security
RUN groupadd -r spargviz && useradd -r -g spargviz spargviz \
    && chown -R spargviz:spargviz /app

USER spargviz

# Start production server
CMD ["conda", "run", "--no-capture-output", "-n", "sparg_viz", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
