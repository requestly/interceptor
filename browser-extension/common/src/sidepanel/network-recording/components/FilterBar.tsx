import React from "react";

const METHODS = ["ALL", "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;

interface FilterBarProps {
  filter: { text: string; method: string };
  onFilterChange: (filter: { text: string; method: string }) => void;
}

const FilterBar: React.FC<FilterBarProps> = ({ filter, onFilterChange }) => {
  return (
    <div className="filter-bar">
      <div className="filter-input-wrapper">
        <svg
          className="search-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#9e9e9e"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          className="filter-input"
          placeholder="Filter requests..."
          value={filter.text}
          onChange={(e) => onFilterChange({ ...filter, text: e.target.value })}
        />
        {filter.text && (
          <button className="filter-clear" onClick={() => onFilterChange({ ...filter, text: "" })}>
            ×
          </button>
        )}
      </div>
      <div className="method-chips">
        {METHODS.map((method) => (
          <button
            key={method}
            className={`method-chip ${filter.method === method ? "method-chip--active" : ""}`}
            onClick={() => onFilterChange({ ...filter, method })}
          >
            {method === "ALL" ? "All" : method}
          </button>
        ))}
      </div>
    </div>
  );
};

export default FilterBar;
