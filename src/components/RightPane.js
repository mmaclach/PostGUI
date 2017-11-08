// @flow weak
import React, { Component } from 'react';
import axios from 'axios';
import axiosCancel from 'axios-cancel';
import PropTypes from 'prop-types';
import { withStyles } from 'material-ui/styles';
import Paper from 'material-ui/Paper';
import { CardHeader } from 'material-ui/Card';
import Snackbar from 'material-ui/Snackbar';
import TextField from 'material-ui/TextField';
import SubmitButton from './SubmitButton.js';
import Typography from 'material-ui/Typography';
import { FormControlLabel } from 'material-ui/Form';
import Checkbox from 'material-ui/Checkbox';

import IconButton from 'material-ui/IconButton';
import CloseIcon from 'material-ui-icons/Close';

import DataTable from './DataTable.js';
import RightPaneChips from './RightPaneChips.js';

import '../styles/QueryBuilder.css';

let lib = require('../utils/library.js');

const defaultRules = lib.getQBRules();

const timeout = 2000;
const maxRowsInOutput = 250000;

axiosCancel(axios, {
	debug: false // default 
});

class RightPane extends Component {
	constructor(props) {
		super(props);
		this.state = {
			dbIndex: props.dbIndex,
			table: props.table,
			columns: props.columns,
			visibleColumns: props.visibleColumns,
			leftPaneVisibility: props.leftPaneVisibility,
			rules: null,
			submitLoading: false,
			submitError: false,
			submitSuccess: false,
			rows: null,
			snackBarVisibility: false,
			exactRowCount: false,
			snackBarMessage: "Unknown error occured",
			rowLimit: 25000,
			url: ""
		}
	}

	componentWillReceiveProps(newProps) {
		// Get rid of the timer
		clearTimeout(this.timer);
		this.timer = null;

		if (newProps.visibleColumns !== undefined && 
			this.state.dbIndex === newProps.dbIndex && 
			this.state.table === newProps.table && 
			this.state.columns === newProps.columns && 
			this.state.leftPaneVisibility === newProps.leftPaneVisibility &&
			this.state.rules === newProps.rules) {
			this.setState({
				visibleColumns: newProps.visibleColumns
			});
		} else if (this.state.leftPaneVisibility !== newProps.leftPaneVisibility) {
			this.setState({
				leftPaneVisibility: newProps.leftPaneVisibility
			});
		} else if (this.state.dbIndex !== newProps.dbIndex) {
			this.setState({
				dbIndex: newProps.dbIndex,
				table: "",
				columns: [],
				visibleColumns: [],
				leftPaneVisibility: true,
				rules: null,
				submitLoading: true,
				submitError: false,
				submitSuccess: false,
				rawData: [],
				rows: null
			}, () => {
				this.rebuildQueryBuilder(this.refs.queryBuilder, newProps.dbIndex, newProps.table, newProps.columns, newProps.rules);
				let url = lib.getDbConfig(this.state.dbIndex, "url") + "/" + this.state.table;
				this.setState({ url: url + "?limit=10" });
				this.fetchOutput(url + "?limit=10", true);
			});
		} else {
			this.setState({
				dbIndex: newProps.dbIndex,
				table: newProps.table,
				columns: newProps.columns,
				visibleColumns: newProps.visibleColumns,
				leftPaneVisibility: newProps.leftPaneVisibility,
				rules: newProps.rules,
				submitLoading: false,
				submitError: false,
				submitSuccess: false,
				rawData: [],
				rows: null
			}, () => {
				this.rebuildQueryBuilder(this.refs.queryBuilder, newProps.dbIndex, newProps.table, newProps.columns, newProps.rules);
				let url = lib.getDbConfig(this.state.dbIndex, "url") + "/" + this.state.table;
				this.setState({ url: url + "?limit=10" });
				this.fetchOutput(url + "?limit=10", true);
			});
		}
	}

	componentDidMount() {
		const element = this.refs.queryBuilder;
		this.initializeQueryBuilder(element);
	}

	componentWillUnmount() {
		window.$(this.refs.queryBuilder).queryBuilder('destroy');
		axios.cancel("qbAxiosReq");
		axios.cancelAll();
	}

	// Creates the QB on first render with default table (error msg for now)
	initializeQueryBuilder(element, newRules = null) {
		try {
			const filters = lib.getQBFilters(this.state.dbIndex, this.state.table, this.state.columns);
			const rules = newRules ? newRules : defaultRules;

			window.$(element).queryBuilder({ filters, rules, plugins: ['not-group'] });
		} catch (error) {
			console.log(error);
		}
	}

	// Destroys the old one, and creates a new QB based on the selected view's attributes
	rebuildQueryBuilder(element, dbIndex, table, columns, newRules) {
		const rules = newRules ? newRules : defaultRules;
		const filters = lib.getQBFilters(dbIndex, table, columns);

		// Create a list of columns found in the new rules
		let columnsInNewQBRules = [];
		for (let i = 0; i < rules['rules'].length; i++) {
			columnsInNewQBRules.push(rules['rules'][i]['field']);
		}
		
		// Check if all columns found in the new rules are found in the QB columns list
		let allRulesColumnsInColumnsArray = true;
		for (let i = 0; i < columnsInNewQBRules.length; i++) {
			if (lib.inArray(columnsInNewQBRules[i], columns) === false) {
				allRulesColumnsInColumnsArray = false;
			}
		}

		// if all rules columns are present in list of columns, rebuild with the rules!
		if (allRulesColumnsInColumnsArray) {
			window.$(element).queryBuilder('destroy');
			window.$(element).queryBuilder({ filters, rules, plugins: ['not-group'] });
		} else {
			window.$(element).queryBuilder('destroy');
			window.$(element).queryBuilder({ filters, defaultRules, plugins: ['not-group'] });
		}
	}

	// Extracts the rules recursively
	recursiveRulesExtraction(notPrefix, condition, rules) {
		let select = notPrefix + condition.toLowerCase() + "(";
		for (let i = 0; i < rules.length; i++) {
			// iterating over the first rules
			let notPrefixLocal = rules[i]['not'] === true ? "not." : "";
			
			if (rules[i]['condition'] === "OR" || rules[i]['condition'] === "AND") {
				if (i === (rules.length - 1)) {
					select += this.recursiveRulesExtraction(notPrefixLocal, rules[i]['condition'], rules[i]['rules']);
				} else {
					select += this.recursiveRulesExtraction(notPrefixLocal, rules[i]['condition'], rules[i]['rules']) + ",";
				}
			} else {
				let containsWildCards = rules[i]['operator'] === "contains" ? (rules[i]['value'].indexOf("*") === -1 ? "*" : "") : ""; // equals * only when user forgets to have at least 1 * in the value input box

				// For when left and right brakcets are needed
				let leftBracket = rules[i]['operator'] === "in" ? "(" : "";
				let rightBracket = rules[i]['operator'] === "in" ? ")" : "";

				if (i === (rules.length - 1)) {
					select += rules[i]['id'] + "." + lib.translateOperatorToPostgrest(rules[i]['operator']) + "." + containsWildCards + leftBracket + rules[i]['value'] + rightBracket + containsWildCards;
				} else {
					select += rules[i]['id'] + "." + lib.translateOperatorToPostgrest(rules[i]['operator']) + "." + containsWildCards + leftBracket + rules[i]['value'] + rightBracket + containsWildCards + ",";
				}
			}
		}
		select += ")"
		return select;
	}

	// Based on the extracted rules, it builds a PostgREST compliant URL for API call
	buildURLFromRules(rules) {
		let url = lib.getDbConfig(this.state.dbIndex, "url") + "/" + this.state.table;

		// if it is valid, proceed
		if (rules && rules['valid'] && rules['valid'] === true) {
			url += "?";

			let notPrefix = "";
			if (rules['not'] === true) {
				notPrefix = "not.";
			}

			let firstCondition = rules['condition'];
			let firstRules = rules['rules'];

			let conds = this.recursiveRulesExtraction(notPrefix, firstCondition + "=", firstRules);
			url += conds;
			url += "&limit=" + this.state.rowLimit;

			// Add SELECT columns... i.e. which columsn to retrieve
			//url += "&select=" + this.state.selectColumns;
		}
		/* else if (this.state.selectColumns !== null && this.state.selectColumns !== [] && this.state.selectColumns !== "") {
		            // Add SELECT columns... but this time, only selected columns, NO FILTERS
		            url += "?select=" + this.state.selectColumns;
		        }*/
		else {
			url += "?limit=" + this.state.rowLimit;
			// TODO: display a Snack bar showing an error!!!
			this.setState({
				snackBarVisibility: true,
				snackBarMessage: "Incomplete query",
			}, () => {
				this.timer = setTimeout(() => {
					this.setState({
						snackBarVisibility: false,
						snackBarMessage: "Unknown error"
					});
				}, 2500);
			});
		}

		// Send updated URL to the HistoryPane
		this.props.addToHistory(url, rules);

		return url;
	}

	fetchOutput(url, skipFullCount = false) {
		// Get rid of the timer
		clearTimeout(this.timer);
		this.timer = null;

		let exactCountHeader = { Prefer: 'count=exact' };
		let inexactCountHeader = { Prefer: 'count=estimated' };
		axios.get(url, { headers: this.state.exactRowCount === true && skipFullCount === false ? exactCountHeader : inexactCountHeader, requestId: "qbAxiosReq" })
			.then((response) => {
				let responseRows = null;
				let totalRows = null;
				if (response.headers["content-range"] !== undefined && response.headers["content-range"] !== null) {
					responseRows = 1 + parseInt(response.headers["content-range"].replace("/*", "").replace("0-", ""), 10);
					totalRows = parseInt(response.headers["content-range"].replace(/0-\d*\//, ""), 10);
				}
				
				this.setState({
					rawData: response.data,
					rows: responseRows,
					totalRows: totalRows,
					submitLoading: false,
					submitError: false,
					submitSuccess: true
				}, () => {
					this.timer = setTimeout(() => {
						this.setState({
							submitLoading: false,
							submitSuccess: false,
							submitError: false
						})
					}, timeout);
				});
			})
			.catch((error) => {
				console.log("HTTP Req:", error);
				this.setState({
					rawData: [],
					rows: null,
					submitLoading: false,
					submitSuccess: true,
					submitError: true // both true implies request successfully reported an error
				}, () => {
					this.timer = setTimeout(() => {
						this.setState({
							submitLoading: false,
							submitSuccess: false,
							submitError: false
						})
					}, timeout);
				});
			});
	}

	handleSubmitButtonClickCancelQuery() {
		axios.cancel("qbAxiosReq");
		axios.cancelAll();
	}


	handleSubmitButtonClick() {
		// Get rid of the timer
		clearTimeout(this.timer);
		this.timer = null;

		event.stopPropagation();
		// first show loading
		this.setState({
			rawData: [],
			rows: 0,
			submitLoading: true,
			submitError: false,
			submitSuccess: false
		}, () => {
			const rules = window.$(this.refs.queryBuilder).queryBuilder('getRules');
			this.setState({ rules: rules }, () => {
				let url = this.buildURLFromRules(rules);
				this.fetchOutput(url);
				this.setState({ url: url });
			});
			return rules;
		});
	}


	handleRequestClose = () => {
		this.setState({ snackBarVisibility: false });
	};

	handleRowLimitChange(event) {
		let newLimit = event.target.value;
		if (newLimit <= 0) {
			newLimit = 1;
		} else if (newLimit > maxRowsInOutput) {
			newLimit = maxRowsInOutput;
		}

		this.setState({ rowLimit: parseInt(newLimit, 10) });
	}

	handleGetExactRowCountToggle() {
        if (this.state.exactRowCount === true) {
            this.setState({
                exactRowCount: false
            }/*, () => {
                this.createFileName();
            }*/);
        } else {
            this.setState({
                exactRowCount: true
            }/*, () => {
                this.createFileName();
            }*/);
        }
    }

	render() {
		const classes = this.props.classes;

		let tableRename = lib.getTableConfig(this.state.dbIndex, this.state.table, "rename");
		let tableDisplayName = tableRename ? tableRename : this.state.table;

		let tableDescription = lib.getTableConfig(this.props.dbIndex, this.props.table, "description") ? lib.getTableConfig(this.props.dbIndex, this.props.table, "description") : "";

		let hideClass = this.state.table ? "" : classes.hide;
		let leftMarginClass = this.state.leftPaneVisibility === true ? classes.root : classes.rootInvisibleLeft;
		let paperClasses = hideClass + " " + leftMarginClass;

		return (
			<div className={classes.middlePaperSection}>

				<Snackbar 	anchorOrigin={{vertical: "bottom", horizontal: "center"}}
							open={this.state.snackBarVisibility}
							onRequestClose={this.handleRequestClose}
							SnackbarContentProps={{ 'aria-describedby': 'message-id', }}
							message={<span id="message-id">{this.state.snackBarMessage}</span>}
							action={[ <IconButton key="close" aria-label="Close" color="accent" className={classes.close} onClick={this.handleRequestClose}> <CloseIcon /> </IconButton> ]} />

				<Paper className={paperClasses} elevation={5}>
					<CardHeader title={tableDisplayName} subheader={tableDescription} />

					<Typography type="subheading" className={classes.cardMarginLeftTop} >Query Builder</Typography>
						<div id='query-builder' ref='queryBuilder'/>

						<Typography type="body1" className={classes.cardMarginLeftTop}>Options</Typography>

						<div onClick={this.handleSubmitButtonClickCancelQuery.bind(this)}>
							<SubmitButton 
								dbIndex={this.state.dbIndex} 
								table={this.state.table} 
								leftPaneVisibility={this.state.leftPaneVisibility} 
								getRules={this.handleSubmitButtonClick.bind(this)} 
								loading={this.state.submitLoading} 
								success={this.state.submitSuccess} 
								error={this.state.submitError} />
						</div>

						<TextField 
							required 
							id="rowLimit" 
							type="number" 
							label="Row-limit" 
							value={this.state.rowLimit.toString()} 
							className={classes.textField && classes.cardMarginLeft} 
							margin="normal" 
							onChange={this.handleRowLimitChange.bind(this)} />

						<FormControlLabel control={ <Checkbox onChange={this.handleGetExactRowCountToggle.bind(this)} value="getExactRowCount" /> } checked={this.state.exactRowCount} label={"Get exact row count (slow)"} className={classes.marginLeft} />

					<Typography type="subheading" className={classes.cardMarginLeftTop}>Query Results</Typography>
						<RightPaneChips rows={this.state.rows} totalRows={this.state.totalRows} rowLimit={this.state.rowLimit} maxRows={maxRowsInOutput}/>

						<div className={ classes.cardMarginLeftRightTop } >
							<DataTable
								dbIndex={this.state.dbIndex}
								table={this.state.table}
								columns={this.state.visibleColumns ? this.state.visibleColumns : this.state.columns}
								data={this.state.rawData}
								url={this.state.url}
								noDataText={this.state.submitLoading ? "Loading ..." : (this.state.submitError ? "Query error" : (this.state.submitSuccess ? "Success!" : "No rows found"))} />
						</div>
				</Paper>
			</div>
		);
	}
}

RightPane.propTypes = {
	classes: PropTypes.object.isRequired,
};

const styleSheet = {
	root: {
		paddingBottom: 50,
		marginLeft: '30%',
		marginBottom: '2%'
	},
	rootInvisibleLeft: {
		paddingBottom: 50,
		marginLeft: '1%',
	},
	middlePaperSection: {
		width: '99%',
		height: '100%',
		marginTop: 75
	},
	cardMarginLeft: { // For items within the same section
		marginLeft: 32
	},
	cardMarginLeftRightTop: {
		marginLeft: 16,
		marginTop: 16,
		marginRight: 6
	},
	cardMarginLeftTop: { // For a new section
		marginLeft: 16,
		marginTop: 32 // want a bit more space at top to clearly indicate new section...
	},
	textField: {
		marginLeft: 5,
		marginRight: 5,
		width: 300
	},
	hide: {
		opacity: 0.0,
		marginTop: 75
	},
	marginLeft: {
		marginLeft: 200
	}
};

export default withStyles(styleSheet)(RightPane);