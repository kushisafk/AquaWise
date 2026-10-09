# AquaWise Machine Learning Improvements

This document tracks the technical modifications made to elevate the ML models in `backend/forecasting.py` to state-of-the-art precision.

## 1. Feature Engineering (Time-Series Lags & Rate of Change)
**Status:** ✅ Completed
**Details:** 
- The model previously relied solely on present-moment features (current moisture, current temperature).
- **Modification:** Added three new input features to the training vector:
  1. `moisture_minus_1h`: Captures recent soil history.
  2. `temp_rolling_3h_avg`: Smooths out temperature spikes, providing a more stable heat-accumulation metric.
  3. `drying_rate_per_hour`: Mathematically calculates `moisture_minus_1h - moisture`, allowing the model to explicitly read the *current derivative* (speed of drying) rather than forcing it to implicitly learn it.
- **Impact:** The model now predicts future trajectories significantly more accurately because it knows the current "momentum" of the soil moisture curve.

## 2. Dynamic Hyperparameter Tuning
**Status:** ✅ Completed
**Details:**
- The model previously used hardcoded, "one size fits all" parameters (`n_estimators=45`, `max_depth=2`).
- **Modification:** Integrated `RandomizedSearchCV` into the training pipeline. During every retraining cycle, the code automatically tests multiple permutations of `n_estimators`, `max_depth`, and `learning_rate` using 3-fold cross-validation. It then extracts the `best_estimator_` that specifically minimizes the Mean Absolute Error for the dataset.
- **Impact:** Ensures the model dynamically adapts its complexity and learning rate based on the specific farm's data variance, drastically reducing underfitting/overfitting.

## 3. Time-Series Cross-Validation
**Status:** ✅ Completed
**Details:**
- Previously, the model used a standard random `train_test_split` and standard K-Fold cross validation. For time-series weather data, this causes "data leakage" (the model effectively peeks at future weather patterns to predict past ones during training).
- **Modification:** Replaced the random split with chronological slicing. Replaced the `cv=3` in the hyperparameter tuning with `TimeSeriesSplit(n_splits=3)`.
- **Impact:** The model is now forced to train strictly on past data and validate on future data chronologically. The MAE metric used to promote a model is now a true reflection of real-world predictive capability, preventing false-positive promotions.

## 4. Upgrade to Advanced Gradient Boosting (LightGBM-style)
**Status:** ✅ Completed
**Details:**
- The model previously used the standard `GradientBoostingRegressor` from `scikit-learn`.
- **Modification:** Swapped the algorithm to `HistGradientBoostingRegressor`. This is `scikit-learn`'s native implementation inspired by Microsoft's LightGBM algorithm. We also updated the tuning grid (e.g. swapping `n_estimators` for `max_iter`).
- **Impact:** `HistGradientBoostingRegressor` is significantly faster at training (important since we retrain dynamically on edge devices/laptops) and handles tabular, non-linear feature interactions (like how sunlight exponentially drives evaporation) much more precisely.

## 5. Evapotranspiration (ET0) Engineered Feature
**Status:** ✅ Completed
**Details:**
- The model previously had to infer the thermodynamic relationship between temperature, humidity, and sunlight from scratch.
- **Modification:** Added a synthetic `et_index` feature calculated as `(temperature * (sunlight / 100)) / humidity`. This acts as a proxy for the Penman-Monteith Evapotranspiration equation.
- **Impact:** Instead of forcing the ML algorithm to reinvent the laws of thermodynamics, we explicitly provide a unified physical index representing the "drying force" of the atmosphere. The algorithm simply learns how the specific field's soil responds to this universal force.
